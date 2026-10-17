import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Profile {
  host: string;
  port: number;
  database: string;
  user: string;
  // Where the password lives. Missing means "prompt": never stored on this machine.
  passwordStorage?: "keyring" | "prompt";
}

export interface Config {
  defaultProfile?: string;
  // Database on the default profile's server that commands use instead of the profile's own.
  defaultDatabase?: string;
  profiles: Record<string, Profile>;
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
    return JSON.parse(await readFile(join(dir, "config.json"), "utf8")) as Config;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { profiles: {} };
    }

    throw error;
  }
}

export async function saveConfig(
  config: Config,
  dir = defaultConfigDir(),
): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(
    join(dir, "config.json"),
    `${JSON.stringify(config, null, 2)}\n`,
    { mode: 0o600 },
  );
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

  return `postgresql://${encode(profile.user)}:${encode(password)}@${profile.host}:${profile.port}/${encode(profile.database)}`;
}
