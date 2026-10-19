import type { Pool } from "pg";
import { assertPageArgs } from "./page-args.js";
import { quoteIdentifier } from "./quote.js";
import { keysetSql, type KeysetPage } from "./keyset.js";

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
  page?: KeysetPage,
  knownColumns?: string[],
): Promise<Record<string, unknown>[]> {
  assertPageArgs(limit, offset);

  const columns =
    knownColumns ??
    (
      await pool.query<{ column_name: string }>(
        `
          SELECT column_name
          FROM information_schema.columns
          WHERE table_schema = $1
            AND table_name = $2
        `,
        [schema, tableName],
      )
    ).rows.map((row) => row.column_name);

  const columnExists = columns.includes(filter.column);

  if (!columnExists) {
    throw new Error(`Column "${filter.column}" was not found.`);
  }

  const keyset = page ? keysetSql(page, 2) : null;
  const sql = `
    SELECT *
    FROM ${quoteIdentifier(schema)}.${quoteIdentifier(tableName)}
    WHERE ${quoteIdentifier(filter.column)} = $1
    ${keyset?.predicate ? `AND ${keyset.predicate}` : ""}
    ${keyset ? `ORDER BY ${keyset.orderBy}` : ""}
    LIMIT ${limit}${keyset ? "" : ` OFFSET ${offset}`};
  `;

  const result = await pool.query(sql, [filter.value, ...(keyset?.values ?? [])]);

  return keyset?.reverse ? result.rows.reverse() : result.rows;
}
