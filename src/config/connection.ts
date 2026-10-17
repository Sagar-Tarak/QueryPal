import { getPassword } from "./password.js";
import { buildConnectionString, loadConfig } from "./profiles.js";

export interface ResolvedConnection {
  connectionString: string;
  // Where it came from, for messages like `querypal test`.
  source: string;
}

// Same server, user and password; only the database name changes.
export function withDatabase(connectionString: string, database: string): string {
  const url = new URL(connectionString);

  url.pathname = `/${encodeURIComponent(database)}`;

  return url.toString();
}

export async function resolveConnection(
  profileName?: string,
  database?: string,
): Promise<ResolvedConnection> {
  const resolved = await pickConnection(profileName);

  if (!database) {
    return resolved;
  }

  return {
    connectionString: withDatabase(resolved.connectionString, database),
    source: `${resolved.source}, database "${database}"`,
  };
}

// Order: --profile, DATABASE_URL, default profile, first-run setup.
async function pickConnection(profileName?: string): Promise<ResolvedConnection> {
  if (!profileName && process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL, source: "DATABASE_URL" };
  }

  const config = await loadConfig();
  const name = profileName ?? config.defaultProfile;

  if (name) {
    const profile = config.profiles[name];

    if (!profile) {
      throw new Error(`Profile "${name}" not found. Run: querypal profile list`);
    }

    const connectionString = buildConnectionString(
      profile,
      await getPassword(name, profile.passwordStorage),
    );

    // The saved database belongs to the default profile only, never to an explicit -p.
    const saved = profileName ? undefined : config.defaultDatabase;

    return {
      connectionString: saved ? withDatabase(connectionString, saved) : connectionString,
      source: `profile "${name}"${profileName ? "" : " (default)"}${saved ? `, database "${saved}" (saved)` : ""}`,
    };
  }

  if (process.stdin.isTTY) {
    // Loaded on demand so commands that already have a connection never pay for the UI library.
    const { runSetupScreen } = await import("../tui/start.js");
    const setup = await runSetupScreen();

    if (!setup) {
      throw new Error("Setup cancelled.");
    }

    return { connectionString: setup.connectionString, source: `profile "${setup.name}" (new)` };
  }

  throw new Error("No database configured. Run: querypal init, or set DATABASE_URL.");
}
