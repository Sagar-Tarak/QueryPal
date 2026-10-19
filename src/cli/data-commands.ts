import { confirm } from "@inquirer/prompts";
import { Command } from "commander";
import type { Pool } from "pg";
import { promptContext } from "../config/password.js";
import { describeTable } from "../database/postgres/describe-table.js";
import { explainError } from "../database/postgres/errors.js";
import { findRecords } from "../database/postgres/find-records.js";
import {
  mutateRecords,
  parseMutationValue,
  type Mutation,
  type MutationPreview,
} from "../database/postgres/mutate-records.js";
import { listTables } from "../database/postgres/tables.js";
import { parseColumnValue } from "./parse-column-value.js";

type PoolRunner = (
  failureMessage: string,
  run: (pool: Pool, source: string, accessLevel: "read" | "readwrite") => Promise<void>,
) => Promise<void>;

const SCHEMA_FLAG = "-s, --schema <name>";

interface MutationOptions {
  limit: string;
  schema?: string;
  yes?: boolean;
  all?: boolean;
  where?: string[];
}

function addMutationOptions(command: Command): Command {
  return command
    .option("-l, --limit <number>", "maximum matching rows, 1 to 100", "100")
    .option(SCHEMA_FLAG, "schema of the table (default: public)")
    .option(
      "-w, --where <condition>",
      "filter rows; repeat for AND conditions",
      (value, previous: string[] = []) => [...previous, value],
    )
    .option("--all", "allow this filter when it matches every row")
    .option("--yes", "apply after preview without asking");
}

// Accepts "orders" with --schema, or "sales.orders". Default schema: public.
function resolveTable(name: string, schemaOption?: string) {
  const dot = name.indexOf(".");

  if (dot > 0) {
    return { schema: name.slice(0, dot), table: name.slice(dot + 1) };
  }

  return { schema: schemaOption ?? "public", table: name };
}

function parsePair(text: string, label: string): { column: string; value: string | null } {
  const pair = parseColumnValue(text);

  if (!pair) throw new Error(`Invalid ${label} "${text}". Use column=value.`);

  return { column: pair.column, value: parseMutationValue(pair.value) };
}

function parseWhere(filters: string[], where?: string): { column: string; value: string | null }[] {
  const result = [...filters, ...(where ? [where] : [])].map((filter) =>
    parsePair(filter, "filter"),
  );
  if (new Set(result.map(({ column }) => column)).size !== result.length)
    throw new Error("Use each filter column only once.");
  return result;
}

async function runMutation(
  pool: Pool,
  source: string,
  accessLevel: "read" | "readwrite",
  tableName: string,
  filters: string[],
  mutation: Mutation,
  options: MutationOptions,
): Promise<void> {
  if (accessLevel !== "readwrite") {
    throw new Error(
      "This connection is read-only. Enable 'Allow writes' for a saved profile, then use --profile <name>.",
    );
  }

  const parsedFilters = parseWhere(filters);
  const { schema, table } = resolveTable(tableName, options.schema);
  const result = await mutateRecords(pool, {
    schema,
    table,
    filters: parsedFilters,
    mutation,
    limit: Number(options.limit),
    allowAll: options.all,
    source,
    confirm: async (preview: MutationPreview) => {
      console.log(`Preview: ${preview.operation.toUpperCase()} ${preview.schema}.${preview.table}`);
      console.log(
        `Where: ${preview.filters.map(({ column, value }) => `${column}=${value === null ? "NULL" : value}`).join(" AND ")}`,
      );

      if (preview.changes) {
        console.log(
          "Changes:",
          JSON.stringify(
            Object.fromEntries(preview.changes.map((change) => [change.column, change.value])),
          ),
        );
      }

      console.log(`Matched ${preview.rows.length} row${preview.rows.length === 1 ? "" : "s"}:`);
      console.log(JSON.stringify(preview.rows, null, 2));
      console.log("Warning: triggers (and delete cascades) may change rows outside this backup.");

      if (options.yes) return true;
      if (!process.stdin.isTTY) {
        console.log("Preview only. Use --yes to apply.");
        return false;
      }

      return confirm(
        { message: `Apply ${preview.operation} to ${preview.rows.length} rows?`, default: false },
        promptContext,
      );
    },
  });

  if (result.count === 0) {
    console.log("No matching rows found.");
  } else if (!result.applied) {
    console.log("No changes made.");
  } else {
    console.log(
      `${mutation.operation === "update" ? "Updated" : "Deleted"} ${result.count} row${result.count === 1 ? "" : "s"}.`,
    );
    console.log(`Backup: ${result.backupPath}`);

    if (!result.backupFinalized)
      console.error("The change committed, but the backup still has pending status.");
  }
}

export function registerDataCommands(program: Command, usePool: PoolRunner): void {
  program
    .command("tables")
    .description("List tables in the connected PostgreSQL database")
    .option(SCHEMA_FLAG, "only list tables in this schema")
    .action((options: { schema?: string }) =>
      usePool("Could not query PostgreSQL.", async (pool) => {
        const tables = await listTables(pool, options.schema);

        if (tables.length === 0) {
          console.log("No tables found.");
          return;
        }

        for (const table of tables) {
          console.log(`${table.schema}.${table.name}`);
        }
      }),
    );

  program
    .command("describe <tableName>")
    .description("Show the columns of a table (use schema.table or --schema)")
    .option(SCHEMA_FLAG, "schema of the table (default: public)")
    .action((tableName: string, options: { schema?: string }) =>
      usePool("Could not describe table.", async (pool) => {
        const { schema, table } = resolveTable(tableName, options.schema);
        const columns = await describeTable(pool, table, schema);

        if (columns.length === 0) {
          console.log(`Table "${table}" was not found in the ${schema} schema.`);
          return;
        }

        console.log(`Columns for ${schema}.${table}:\n`);

        for (const column of columns) {
          const nullable = column.nullable ? "YES" : "NO";
          const defaultValue = column.defaultValue ?? "-";

          console.log(
            `${column.name.padEnd(15)} ${column.dataType.padEnd(20)} Nullable: ${nullable.padEnd(3)} Default: ${defaultValue}`,
          );
        }
      }),
    );

  program
    .command("find <tableName> <filter>")
    .description("Find records using a column=value filter")
    .option("-l, --limit <number>", "rows to return, 1 to 100", "20")
    .option(SCHEMA_FLAG, "schema of the table (default: public)")
    .action(
      (tableName: string, filterText: string, options: { limit: string; schema?: string }) => {
        const filter = parseColumnValue(filterText);

        if (!filter) {
          console.error("Invalid filter. Use column=value, for example id=1.");
          process.exitCode = 1;
          return;
        }

        const { schema, table } = resolveTable(tableName, options.schema);

        return usePool("Could not find records.", async (pool) => {
          const records = await findRecords(pool, table, filter, Number(options.limit), schema);

          if (records.length === 0) {
            console.log("No matching records found.");
            return;
          }

          console.log(JSON.stringify(records, null, 2));
        });
      },
    );

  const update = addMutationOptions(
    program
      .command("update <tableName> <changes...>")
      .description("Update rows (add --where column=value to narrow matches)"),
  );
  update.action((tableName: string, assignments: string[], options: MutationOptions) => {
    let changes: { column: string; value: string | null }[];

    try {
      changes = assignments.map((assignment) => parsePair(assignment, "change"));
    } catch (error) {
      console.error(explainError(error));
      process.exitCode = 1;
      return;
    }

    if (!options.where?.length) {
      console.error("Add a filter with --where column=value.");
      process.exitCode = 1;
      return;
    }

    return usePool("Could not update rows.", (pool, source, accessLevel) =>
      runMutation(
        pool,
        source,
        accessLevel,
        tableName,
        options.where ?? [],
        { operation: "update", changes },
        options,
      ),
    );
  });

  const remove = addMutationOptions(
    program.command("delete <tableName>").description("Delete rows matching --where conditions"),
  );
  remove.action((tableName: string, options: MutationOptions) => {
    if (!options.where?.length) {
      console.error("Add a filter with --where column=value.");
      process.exitCode = 1;
      return;
    }

    return usePool("Could not delete rows.", (pool, source, accessLevel) =>
      runMutation(
        pool,
        source,
        accessLevel,
        tableName,
        options.where ?? [],
        { operation: "delete" },
        options,
      ),
    );
  });
}
