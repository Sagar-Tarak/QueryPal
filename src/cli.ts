import { Command } from "commander";
import { createRequire } from "node:module";
import type { Pool } from "pg";
import { registerDataCommands } from "./cli/data-commands.js";
import { withPostgresPool } from "./database/postgres/client.js";
import { resolveConnection } from "./config/connection.js";
import { deleteSecret } from "./config/keyring.js";
import { loadConfig, removeProfile, saveConfig, setDefault } from "./config/profiles.js";
import { checkConnection } from "./database/postgres/check-connection.js";
import { explainError } from "./database/postgres/errors.js";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

async function guard(failureMessage: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    console.error(failureMessage);
    console.error("Reason:", explainError(error));
    process.exitCode = 1;
  }
}

interface GlobalOptions {
  profile?: string;
  database?: string;
}

async function withPool(
  globals: GlobalOptions,
  failureMessage: string,
  run: (pool: Pool, source: string, accessLevel: "read" | "readwrite") => Promise<void>,
): Promise<void> {
  await guard(failureMessage, async () => {
    const { connectionString, accessLevel, source } = await resolveConnection(
      globals.profile,
      globals.database,
    );
    await withPostgresPool(connectionString, accessLevel, (pool) => run(pool, source, accessLevel));
  });
}

export function createCli(): Command {
  const program = new Command();

  program
    .name("querypal")
    .description("A CLI for exploring PostgreSQL databases")
    .version(version)
    .option("-p, --profile <name>", "connection profile to use")
    .option("-d, --database <name>", "use another database on the same server");

  const globals = () => program.opts<GlobalOptions>();
  const usePool = (
    failureMessage: string,
    run: (pool: Pool, source: string, accessLevel: "read" | "readwrite") => Promise<void>,
  ) => withPool(globals(), failureMessage, run);

  program
    .command("init")
    .description("Set up a database connection profile (opens the setup screen)")
    .action(() =>
      guard("Setup failed.", async () => {
        const { startTui } = await import("./tui/start.js");

        await startTui(null, "form");
      }),
    );

  program
    .command("test")
    .description("Check that the connection works and show which one is used")
    .action(() =>
      usePool("Connection failed.", async (pool, source) => {
        const info = await checkConnection(pool);

        console.log(`Connected to "${info.database}" as ${info.user}`);
        console.log(`PostgreSQL ${info.version}, answered in ${info.ms} ms`);
        console.log(`Using: ${source}`);
      }),
    );

  program
    .command("use [profile] [database]")
    .description("Switch the saved profile (and database) all commands use; no arguments shows it")
    .action((profileName?: string, database?: string) =>
      guard("Could not switch.", async () => {
        const config = await loadConfig();

        if (profileName) {
          if (!config.profiles[profileName]) {
            throw new Error(`Profile "${profileName}" not found. Run: querypal profile list`);
          }

          await saveConfig(setDefault(config, profileName, database));
          console.log(`Now using: ${profileName}${database ? `, database ${database}` : ""}`);
          console.log("Run: querypal test");
          return;
        }

        const current = config.defaultProfile && config.profiles[config.defaultProfile];

        if (!current) {
          console.log("No profile selected. Run: querypal use <profile>");
          return;
        }

        console.log(
          `Profile:  ${config.defaultProfile} (${current.user}@${current.host}:${current.port}) [${current.accessLevel ?? "read"}]`,
        );
        console.log(
          `Database: ${config.defaultDatabase ?? current.database}${config.defaultDatabase ? " (saved override)" : " (from profile)"}`,
        );

        if (process.env.DATABASE_URL) {
          console.log("Note: DATABASE_URL is set and takes priority over this.");
        }
      }),
    );

  const profiles = program.command("profile").description("Manage connection profiles");

  profiles
    .command("list")
    .description("List saved profiles (* marks the default)")
    .action(() =>
      guard("Could not read profiles.", async () => {
        const config = await loadConfig();
        const entries = Object.entries(config.profiles);

        if (entries.length === 0) {
          console.log("No profiles. Run: querypal init");
          return;
        }

        for (const [name, p] of entries) {
          const marker = name === config.defaultProfile ? "*" : " ";
          console.log(
            `${marker} ${name} [${p.accessLevel ?? "read"}]  ${p.user}@${p.host}:${p.port}/${p.database}`,
          );
        }
      }),
    );

  profiles
    .command("use <name>")
    .description("Make a profile the default")
    .action((name: string) =>
      guard("Could not switch profile.", async () => {
        const config = await loadConfig();

        if (!config.profiles[name]) {
          throw new Error(`Profile "${name}" not found. Run: querypal profile list`);
        }

        await saveConfig(setDefault(config, name));
        console.log(`Default profile: ${name}`);
      }),
    );

  profiles
    .command("remove <name>")
    .description("Delete a saved profile")
    .action((name: string) =>
      guard("Could not remove profile.", async () => {
        const config = await loadConfig();

        if (!config.profiles[name]) {
          throw new Error(`Profile "${name}" not found. Run: querypal profile list`);
        }

        await saveConfig(removeProfile(config, name));
        deleteSecret(name);
        console.log(`Removed profile: ${name}`);
      }),
    );

  program
    .command("ui")
    .description("Browse tables and search records in an interactive terminal UI")
    .action(async () => {
      const config = await loadConfig();
      const configured = globals().profile || process.env.DATABASE_URL || config.defaultProfile;

      // Nothing to connect to yet: open on the profiles list (or the form, with no profiles).
      if (!configured) {
        await guard("Could not start the UI.", async () => {
          const { startTui } = await import("./tui/start.js");

          await startTui(null, Object.keys(config.profiles).length ? "profiles" : "form");
        });
        return;
      }

      await usePool("Could not start the UI.", async (pool, source, accessLevel) => {
        const { startTui } = await import("./tui/start.js");

        await startTui({ pool, source, accessLevel });
      });
    });

  program
    .command("version")
    .description("Display the QueryPal version")
    .action(() => {
      console.log(`QueryPal v${version}`);
    });

  registerDataCommands(program, usePool);

  return program;
}
