

import type { Pool } from "pg";

export interface ColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
  defaultValue: string | null;
}

export async function describeTable(
  pool: Pool,
  tableName: string,
  schema = "public",
): Promise<ColumnInfo[]> {
  const result = await pool.query<{
    column_name: string;
    data_type: string;
    is_nullable: "YES" | "NO";
    column_default: string | null;
  }>(
    `
      SELECT
        column_name,
        data_type,
        is_nullable,
        column_default
      FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name = $2
      ORDER BY ordinal_position;
    `,
    [schema, tableName],
  );

  return result.rows.map((row) => ({
    name: row.column_name,
    dataType: row.data_type,
    nullable: row.is_nullable === "YES",
    defaultValue: row.column_default,
  }));
}
