import type { Pool } from "pg";
import { assertPageArgs } from "./page-args.js";
import { quoteIdentifier } from "./quote.js";
import { keysetSql, type KeysetPage } from "./keyset.js";

// UI pages use keysets when a primary key is available; CLI callers can keep offset paging.
export async function listRows(
  pool: Pool,
  tableName: string,
  schema: string,
  limit: number,
  offset: number,
  page?: KeysetPage,
): Promise<Record<string, unknown>[]> {
  assertPageArgs(limit, offset);

  if (page) {
    const keyset = keysetSql(page);
    const result = await pool.query(
      `SELECT * FROM ${quoteIdentifier(schema)}.${quoteIdentifier(tableName)}${keyset.predicate ? ` WHERE ${keyset.predicate}` : ""} ORDER BY ${keyset.orderBy} LIMIT ${limit}`,
      keyset.values,
    );

    return keyset.reverse ? result.rows.reverse() : result.rows;
  }

  const result = await pool.query(
    `SELECT * FROM ${quoteIdentifier(schema)}.${quoteIdentifier(tableName)} LIMIT ${limit} OFFSET ${offset}`,
  );

  return result.rows;
}
