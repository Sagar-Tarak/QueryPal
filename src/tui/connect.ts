import type { Pool } from "pg";
import { withDatabase } from "../config/connection.js";
import { buildConnectionString, type Profile } from "../config/profiles.js";
import { checkConnection, type ConnectionInfo } from "../database/postgres/check-connection.js";
import { createPostgresPool } from "../database/postgres/client.js";

export interface Connection {
  pool: Pool;
  source: string;
}

// Connects to a profile (optionally on another database of the same server) and proves it works.
// On failure the pool is closed and the error is thrown.
export async function openConnection(
  name: string,
  profile: Profile,
  password: string,
  database?: string,
): Promise<Connection & { info: ConnectionInfo }> {
  const base = buildConnectionString(profile, password);
  const pool = createPostgresPool(database ? withDatabase(base, database) : base);

  try {
    const info = await checkConnection(pool);

    return { pool, info, source: `profile "${name}"${database ? `, database "${database}"` : ""}` };
  } catch (error) {
    await pool.end();
    throw error;
  }
}
