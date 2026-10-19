import { Pool } from "pg";

export function createPostgresPool(
  connectionString: string,
  accessLevel: "read" | "readwrite" = "read",
): Pool {
  return new Pool({
    connectionString,
    connectionTimeoutMillis: 5000,
    max: 5,
    ...(accessLevel === "read" && { options: "-c default_transaction_read_only=on" }),
  });
}

export async function withPostgresPool<T>(
  connectionString: string,
  accessLevel: "read" | "readwrite",
  run: (pool: Pool) => Promise<T>,
): Promise<T> {
  const pool = createPostgresPool(connectionString, accessLevel);

  try {
    return await run(pool);
  } finally {
    await pool.end();
  }
}
