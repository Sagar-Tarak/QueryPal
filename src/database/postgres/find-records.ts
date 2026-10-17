

import type { Pool } from "pg";
import { assertPageArgs } from "./page-args.js";
import { quoteIdentifier } from "./quote.js";

export interface FindFilter {
  column: string;
  value: string;
}

export async function findRecords(
  pool: Pool,
  tableName: string,
  filter: FindFilter,
  limit = 20,
  schema = "public",
  offset = 0,
): Promise<Record<string, unknown>[]> {
  assertPageArgs(limit, offset);

  const columnResult = await pool.query<{ column_name: string }>(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name = $2
    `,
    [schema, tableName],
  );

  const columnExists = columnResult.rows.some(
    (row) => row.column_name === filter.column,
  );

  if (!columnExists) {
    throw new Error(`Column "${filter.column}" was not found.`);
  }

  const sql = `
    SELECT *
    FROM ${quoteIdentifier(schema)}.${quoteIdentifier(tableName)}
    WHERE ${quoteIdentifier(filter.column)} = $1
    LIMIT ${limit} OFFSET ${offset};
  `;

  const result = await pool.query(sql, [filter.value]);

  return result.rows;
}
