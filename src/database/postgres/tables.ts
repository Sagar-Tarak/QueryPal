

import type { Pool } from "pg";

export interface DatabaseTable {
  schema: string;
  name: string;
}

export async function listTables(
  pool: Pool,
  schema?: string,
): Promise<DatabaseTable[]> {
  const result = await pool.query<{
    table_schema: string;
    table_name: string;
  }>(
    `
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_type = 'BASE TABLE'
      AND table_schema NOT IN ('pg_catalog', 'information_schema')
      AND ($1::text IS NULL OR table_schema = $1)
    ORDER BY table_schema, table_name;
  `,
    [schema ?? null],
  );

  return result.rows.map((row) => ({
    schema: row.table_schema,
    name: row.table_name,
  }));
}
