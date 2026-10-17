import type { Pool } from "pg";
import { assertPageArgs } from "./page-args.js";
import { quoteIdentifier } from "./quote.js";

// ponytail: no ORDER BY, so paging follows physical order. Cheapest on big tables;
// add keyset paging if a table needs a guaranteed order.
export async function listRows(
  pool: Pool,
  tableName: string,
  schema: string,
  limit: number,
  offset: number,
): Promise<Record<string, unknown>[]> {
  assertPageArgs(limit, offset);

  const result = await pool.query(
    `SELECT * FROM ${quoteIdentifier(schema)}.${quoteIdentifier(tableName)} LIMIT ${limit} OFFSET ${offset}`,
  );

  return result.rows;
}
