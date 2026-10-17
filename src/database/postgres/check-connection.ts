import type { Pool } from "pg";

export interface ConnectionInfo {
  database: string;
  user: string;
  version: string;
  ms: number;
}

export async function checkConnection(pool: Pool): Promise<ConnectionInfo> {
  const start = performance.now();
  const result = await pool.query<{ database: string; user: string; version: string }>(
    `SELECT current_database() AS database,
            current_user AS "user",
            current_setting('server_version') AS version`,
  );
  const row = result.rows[0];

  if (!row) {
    throw new Error("The server returned no answer.");
  }

  return { ...row, ms: Math.round(performance.now() - start) };
}
