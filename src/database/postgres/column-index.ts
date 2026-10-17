import type { Pool } from "pg";

// Every table's column names in one query, keyed "schema.table", so tables can be searched by column.
export async function listColumnIndex(pool: Pool): Promise<Record<string, string[]>> {
  const result = await pool.query<{
    table_schema: string;
    table_name: string;
    column_name: string;
  }>(`
    SELECT table_schema, table_name, column_name
    FROM information_schema.columns
    WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
    ORDER BY table_schema, table_name, ordinal_position
  `);

  const index: Record<string, string[]> = {};

  for (const row of result.rows) {
    (index[`${row.table_schema}.${row.table_name}`] ??= []).push(row.column_name);
  }

  return index;
}
