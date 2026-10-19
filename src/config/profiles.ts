import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Profile {
  host: string;
  port: number;
  database: string;
  user: string;
  // Where the password lives. Missing means "prompt": never stored on this machine.
  passwordStorage?: "keyring" | "prompt";
  accessLevel?: "read" | "readwrite";
}

export interface Config {
  defaultProfile?: string;
  // Database on the default profile's server that commands use instead of the profile's own.
  defaultDatabase?: string;
  profiles: Record<string, Profile>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseConfig(value: unknown): Config {
  if (!isRecord(value) || !isRecord(value.profiles)) {
    throw new Error("Invalid QueryPal config: expected an object with a profiles object.");
  }

  for (const [name, profile] of Object.entries(value.profiles)) {
    if (
      !name ||
      !isRecord(profile) ||
      typeof profile.host !== "string" ||
      typeof profile.database !== "string" ||
      typeof profile.user !== "string" ||
      typeof profile.port !== "number" ||
      !Number.isInteger(profile.port) ||
      profile.port < 1 ||
      profile.port > 65535 ||
      (profile.passwordStorage !== undefined &&
        !["keyring", "prompt"].includes(profile.passwordStorage as string)) ||
      (profile.accessLevel !== undefined &&
        !["read", "readwrite"].includes(profile.accessLevel as string))
    ) {
      throw new Error(`Invalid QueryPal config: profile "${name}" is malformed.`);
    }
  }

  if (value.defaultProfile !== undefined && typeof value.defaultProfile !== "string") {
    throw new Error("Invalid QueryPal config: defaultProfile must be a profile name.");
  }

  if (value.defaultDatabase !== undefined && typeof value.defaultDatabase !== "string") {
    throw new Error("Invalid QueryPal config: defaultDatabase must be a database name.");
  }

  return value as unknown as Config;
}

// ponytail: ~/.config on every OS, switch to env-paths if macOS/Windows conventions matter
export function defaultConfigDir(): string {
  return (
    process.env.QUERYPAL_CONFIG_DIR ??
    join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "querypal")
  );
}

export async function loadConfig(dir = defaultConfigDir()): Promise<Config> {
  try {
    return parseConfig(JSON.parse(await readFile(join(dir, "config.json"), "utf8")) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { profiles: {} };
    }

    throw error;
  }
}

export async function saveConfig(config: Config, dir = defaultConfigDir()): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const path = join(dir, "config.json");
  const temporaryPath = join(dir, `.config-${randomUUID()}.tmp`);

  try {
    await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

// The first profile added becomes the default.
export function addProfile(config: Config, name: string, profile: Profile): Config {
  return {
    ...config,
    defaultProfile: config.defaultProfile ?? name,
    profiles: { ...config.profiles, [name]: profile },
  };
}

// Switching profile forgets the old database override, since it belonged to the old server.
export function setDefault(config: Config, profile: string, database?: string): Config {
  const { defaultDatabase: _old, ...rest } = config;

  return { ...rest, defaultProfile: profile, ...(database && { defaultDatabase: database }) };
}

export function removeProfile(config: Config, name: string): Config {
  const { [name]: _removed, ...profiles } = config.profiles;

  if (config.defaultProfile !== name) {
    return { ...config, profiles };
  }

  const { defaultProfile: _profile, defaultDatabase: _database, ...rest } = config;

  return { ...rest, profiles };
}

export const isLocalHost = (host: string): boolean =>
  ["localhost", "127.0.0.1", "::1"].includes(host);

export function buildConnectionString(profile: Profile, password: string): string {
  const encode = encodeURIComponent;
  const host =
    profile.host.includes(":") && !profile.host.startsWith("[")
      ? `[${profile.host}]`
      : profile.host;

  return `postgresql://${encode(profile.user)}:${encode(password)}@${host}:${profile.port}/${encode(profile.database)}`;
}
