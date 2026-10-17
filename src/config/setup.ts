import { confirm, input, password } from "@inquirer/prompts";
import { createPostgresPool } from "../database/postgres/client.js";
import { explainError } from "../database/postgres/errors.js";
import { deleteSecret, saveSecret } from "./keyring.js";
import { promptContext } from "./password.js";
import {
  addProfile,
  buildConnectionString,
  isLocalHost,
  loadConfig,
  saveConfig,
} from "./profiles.js";

const required = (value: string) => value.trim() !== "" || "This is required.";
const isPort = (value: string) =>
  (/^\d+$/.test(value) && Number(value) <= 65535) || "Enter a port from 0 to 65535.";

export async function runSetup(): Promise<{ name: string; connectionString: string }> {
  const config = await loadConfig();
  const isFirst = Object.keys(config.profiles).length === 0;

  const name = (
    await input(
      { message: "Profile name:", default: isFirst ? "local" : undefined, validate: required },
      promptContext,
    )
  ).trim();

  if (
    config.profiles[name] &&
    !(await confirm({ message: `Profile "${name}" exists. Overwrite?`, default: false }, promptContext))
  ) {
    throw new Error("Setup cancelled.");
  }

  const host = await input({ message: "Host:", default: "localhost" }, promptContext);
  const port = Number(
    await input({ message: "Port:", default: "5432", validate: isPort }, promptContext),
  );
  const database = await input({ message: "Database name:", validate: required }, promptContext);
  const user = await input({ message: "Username:", validate: required }, promptContext);
  const secret = await password({ message: "Password:", mask: "*" }, promptContext);

  const profile = { host, port, database, user };
  const connectionString = buildConnectionString(profile, secret);
  const pool = createPostgresPool(connectionString);

  try {
    await pool.query("SELECT 1");
    console.error("Connection OK.");
  } catch (error) {
    console.error("Connection failed:", explainError(error));

    if (!(await confirm({ message: "Save this profile anyway?", default: false }, promptContext))) {
      throw new Error("Setup cancelled.");
    }
  } finally {
    await pool.end();
  }

  const local = isLocalHost(host);
  const wantsKeyring = await confirm(
    {
      message: local
        ? "Save the password in your OS keyring?"
        : "This is a remote database. Save its password on this machine? (not recommended)",
      default: local,
    },
    promptContext,
  );
  const saved = wantsKeyring && saveSecret(name, secret);

  if (wantsKeyring && !saved) {
    console.error("Could not use the OS keyring here. You will be asked for the password each time.");
  }

  if (!saved) {
    deleteSecret(name);
  }

  await saveConfig(
    addProfile(config, name, { ...profile, passwordStorage: saved ? "keyring" : "prompt" }),
  );
  console.error(
    `Saved profile "${name}". ${saved ? "Password saved in the OS keyring." : "Password not saved: set QUERYPAL_PASSWORD or enter it when asked."}`,
  );

  return { name, connectionString };
}
