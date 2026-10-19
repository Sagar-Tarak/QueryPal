import type { Pool } from "pg";
import { describeTable } from "./describe-table.js";
import { findRecords } from "./find-records.js";
import { assertPageArgs } from "./page-args.js";
import { quoteIdentifier } from "./quote.js";
import { keysetSql, type KeysetPage } from "./keyset.js";

// text: contains-match on every column. column "~": contains-match on one column.
// column "=": exact match on one column.
export type SearchFilter = { text: string } | { column: string; op: "=" | "~"; value: string };

// So a typed % or _ is searched for literally instead of acting as a wildcard.
const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, "\\$&")}%`;

export async function searchRecords(
  pool: Pool,
  tableName: string,
  filter: SearchFilter,
  limit: number,
  schema = "public",
  offset = 0,
  page?: KeysetPage,
  knownColumns?: string[],
): Promise<Record<string, unknown>[]> {
  assertPageArgs(limit, offset);

  if ("column" in filter && filter.op === "=") {
    return findRecords(pool, tableName, filter, limit, schema, offset, page, knownColumns);
  }

  const names = knownColumns ?? (await describeTable(pool, tableName, schema)).map((c) => c.name);

  if (names.length === 0) {
    throw new Error(`Table "${tableName}" was not found.`);
  }

  let condition: string;
  let value: string;

  if ("column" in filter) {
    if (!names.includes(filter.column)) {
      throw new Error(`Column "${filter.column}" was not found.`);
    }

    condition = `${quoteIdentifier(filter.column)}::text ILIKE $1`;
    value = filter.value;
  } else {
    condition = names.map((name) => `${quoteIdentifier(name)}::text ILIKE $1`).join(" OR ");
    value = filter.text;
  }

  const keyset = page ? keysetSql(page, 2) : null;
  const result = await pool.query(
    `SELECT * FROM ${quoteIdentifier(schema)}.${quoteIdentifier(tableName)} WHERE ${keyset ? `(${condition})` : condition}${keyset?.predicate ? ` AND ${keyset.predicate}` : ""}${keyset ? ` ORDER BY ${keyset.orderBy}` : ""} LIMIT ${limit}${keyset ? "" : ` OFFSET ${offset}`}`,
    [likePattern(value), ...(keyset?.values ?? [])],
  );

  return keyset?.reverse ? result.rows.reverse() : result.rows;
}
