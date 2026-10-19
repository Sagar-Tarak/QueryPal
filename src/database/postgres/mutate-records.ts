import { randomUUID } from "node:crypto";
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Pool } from "pg";
import { assertRowLimit } from "./page-args.js";
import { quoteIdentifier } from "./quote.js";

export type Mutation =
  | { operation: "update"; changes: { column: string; value: string | null }[] }
  | { operation: "delete" };

export interface MutationPreview {
  operation: Mutation["operation"];
  schema: string;
  table: string;
  filters: { column: string; value: string | null }[];
  rows: Record<string, unknown>[];
  changes?: { column: string; value: string | null }[];
}

export interface MutationResult {
  applied: boolean;
  count: number;
  backupPath?: string;
  backupFinalized?: boolean;
}

const backupDir = () =>
  process.env.QUERYPAL_BACKUP_DIR ??
  join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "querypal", "backups");

export function parseMutationValue(value: string): string | null {
  if (value === "NULL") return null;
  if (value === "\\NULL") return "NULL";
  return value;
}

export { assertRowLimit as assertMutationLimit };

export async function mutateRecords(
  pool: Pool,
  input: {
    schema: string;
    table: string;
    filters: { column: string; value: string | null }[];
    mutation: Mutation;
    limit: number;
    allowAll?: boolean;
    source: string;
    confirm: (preview: MutationPreview) => Promise<boolean>;
  },
): Promise<MutationResult> {
  assertRowLimit(input.limit);

  if (input.filters.length === 0 || input.filters.some(({ column }) => !column))
    throw new Error("At least one filter is required.");
  if (input.mutation.operation === "update" && input.mutation.changes.length === 0) {
    throw new Error("Provide at least one column=value change.");
  }

  const client = await pool.connect();
  let transaction = false;
  let commitAttempted = false;
  let path: string | undefined;

  try {
    const tableResult = await client.query<{ table_type: string }>(
      "SELECT table_type FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2",
      [input.schema, input.table],
    );

    if (tableResult.rows[0]?.table_type !== "BASE TABLE") {
      throw new Error(`Table "${input.table}" was not found or is not a base table.`);
    }

    const columnResult = await client.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2",
      [input.schema, input.table],
    );
    const columns = new Set(columnResult.rows.map((row) => row.column_name));

    for (const filter of input.filters) {
      if (!columns.has(filter.column)) throw new Error(`Column "${filter.column}" was not found.`);
    }

    if (input.mutation.operation === "update") {
      const seen = new Set<string>();

      for (const change of input.mutation.changes) {
        if (!columns.has(change.column))
          throw new Error(`Column "${change.column}" was not found.`);
        if (seen.has(change.column))
          throw new Error(`Column "${change.column}" appears more than once.`);
        seen.add(change.column);
      }
    }

    const relation = `${quoteIdentifier(input.schema)}.${quoteIdentifier(input.table)}`;
    const filterValues: string[] = [];
    const filterSql = input.filters
      .map(({ column, value }) => {
        if (value === null) return `${quoteIdentifier(column)} IS NULL`;
        filterValues.push(value);
        return `${quoteIdentifier(column)} = $${filterValues.length}`;
      })
      .join(" AND ");
    const alias = ["__querypal_ctid", ...columns].reduce(
      (candidate, column) => (candidate === column ? `${candidate}_` : candidate),
      "__querypal_ctid",
    );
    const selected = await client.query<Record<string, unknown>>(
      `SELECT ctid::text AS ${quoteIdentifier(alias)}, * FROM ${relation} WHERE ${filterSql} LIMIT $${filterValues.length + 1}`,
      [...filterValues, input.limit + 1],
    );

    if (selected.rows.length > input.limit) {
      throw new Error(
        `More than ${input.limit} rows match. Add a narrower filter or raise --limit (maximum 100).`,
      );
    }

    if (selected.rows.length > 0) {
      const otherRows = await client.query<{ exists: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM ${relation} WHERE NOT COALESCE((${filterSql}), FALSE)) AS exists`,
        filterValues,
      );

      if (!otherRows.rows[0]?.exists && !input.allowAll) {
        throw new Error(
          "This filter matches every row. Add --all to confirm a whole-table change.",
        );
      }
    }

    const rowIds = selected.rows.map((row) => String(row[alias]));
    const rows = selected.rows.map(({ [alias]: _ctid, ...row }) => row);

    if (rows.length === 0) {
      return { applied: false, count: 0 };
    }

    const preview: MutationPreview = {
      operation: input.mutation.operation,
      schema: input.schema,
      table: input.table,
      filters: input.filters,
      rows,
      ...(input.mutation.operation === "update" && { changes: input.mutation.changes }),
    };

    if (!(await input.confirm(preview))) {
      return { applied: false, count: rows.length };
    }

    await client.query("BEGIN");
    transaction = true;
    await client.query("SET LOCAL lock_timeout = '5s'");
    const locked = await client.query<Record<string, unknown>>(
      `SELECT ctid::text AS ${quoteIdentifier(alias)}, * FROM ${relation} WHERE ctid::text = ANY($1::text[]) FOR UPDATE`,
      [rowIds],
    );
    const lockedRows = new Map(
      locked.rows.map((row) => {
        const id = String(row[alias]);
        const { [alias]: _ctid, ...record } = row;
        return [id, record];
      }),
    );

    if (
      lockedRows.size !== rows.length ||
      rowIds.some((id, index) => JSON.stringify(lockedRows.get(id)) !== JSON.stringify(rows[index]))
    ) {
      throw new Error(
        "Rows changed after the preview. Run the command again to review the latest rows.",
      );
    }

    const id = randomUUID();
    const createdAt = new Date().toISOString();
    path = join(backupDir(), `${id}.json`);
    await mkdir(backupDir(), { recursive: true, mode: 0o700 });
    await chmod(backupDir(), 0o700);
    const backup = {
      version: 1,
      id,
      state: "pending",
      createdAt,
      profile: input.source,
      ...preview,
    };
    await writeFile(path, JSON.stringify(backup, null, 2) + "\n", { mode: 0o600, flag: "wx" });

    if (input.mutation.operation === "update") {
      const assignments = input.mutation.changes.map(
        (change, index) => `${quoteIdentifier(change.column)} = $${index + 1}`,
      );
      const values: (string | null | string[])[] = input.mutation.changes.map(
        (change) => change.value,
      );
      values.push(rowIds);
      const result = await client.query(
        `UPDATE ${relation} SET ${assignments.join(", ")} WHERE ctid::text = ANY($${values.length}::text[])`,
        values,
      );

      if (result.rowCount !== rows.length)
        throw new Error("The number of updated rows changed during the operation.");
    } else {
      const result = await client.query(
        `DELETE FROM ${relation} WHERE ctid::text = ANY($1::text[])`,
        [rowIds],
      );

      if (result.rowCount !== rows.length)
        throw new Error("The number of deleted rows changed during the operation.");
    }

    commitAttempted = true;
    await client.query("COMMIT");
    transaction = false;

    let backupFinalized = true;

    try {
      const pendingPath = `${path}.tmp`;

      await writeFile(
        pendingPath,
        JSON.stringify({ ...backup, state: "committed" }, null, 2) + "\n",
        { mode: 0o600 },
      );
      await rename(pendingPath, path);
    } catch {
      backupFinalized = false;
    }

    return { applied: true, count: rows.length, backupPath: path, backupFinalized };
  } catch (error) {
    if (transaction) await client.query("ROLLBACK").catch(() => undefined);
    if (path && !commitAttempted) await rm(path, { force: true }).catch(() => undefined);
    if (path && commitAttempted) {
      throw new Error(
        `The commit result is uncertain. Check the database before retrying; the backup is at ${path}.`,
        { cause: error },
      );
    }
    throw error;
  } finally {
    client.release();
  }
}
