import { Command } from "commander";
import type { Pool } from "pg";
import { createPostgresPool } from "./database/postgres/client.js";
import { resolveConnection } from "./config/connection.js";
import { deleteSecret } from "./config/keyring.js";
import { loadConfig, removeProfile, saveConfig, setDefault } from "./config/profiles.js";
import { checkConnection } from "./database/postgres/check-connection.js";
import { explainError } from "./database/postgres/errors.js";
import { describeTable } from "./database/postgres/describe-table.js";
import { findRecords } from "./database/postgres/find-records.js";
import { listTables } from "./database/postgres/tables.js";

async function guard(
  failureMessage: string,
  run: () => Promise<void>,
): Promise<void> {
  try {
    await run();
  } catch (error) {
    console.error(failureMessage);
    console.error("Reason:", explainError(error));
    process.exitCode = 1;
  }
}

interface GlobalOptions {
  profile?: string;
  database?: string;
}

async function withPool(
  globals: GlobalOptions,
  failureMessage: string,
  run: (pool: Pool, source: string) => Promise<void>,
): Promise<void> {
  await guard(failureMessage, async () => {
    const { connectionString, source } = await resolveConnection(globals.profile, globals.database);
    const pool = createPostgresPool(connectionString);

    try {
      await run(pool, source);
    } finally {
      await pool.end();
    }
  });
}

// Accepts "orders" with --schema, or "sales.orders". Default schema: public.
function resolveTable(name: string, schemaOption?: string) {
  const dot = name.indexOf(".");

  if (dot > 0) {
    return { schema: name.slice(0, dot), table: name.slice(dot + 1) };
  }

  return { schema: schemaOption ?? "public", table: name };
}

const SCHEMA_FLAG = "-s, --schema <name>";

export function createCli(): Command {
  const program = new Command();

  program
    .name("querypal")
    .description("A CLI for exploring PostgreSQL databases")
    .version("0.1.0")
    .option("-p, --profile <name>", "connection profile to use")
    .option("-d, --database <name>", "use another database on the same server");

  const globals = () => program.opts<GlobalOptions>();
  const usePool = (failureMessage: string, run: (pool: Pool, source: string) => Promise<void>) =>
    withPool(globals(), failureMessage, run);

  program
    .command("init")
    .description("Set up a database connection profile (opens the setup screen)")
    .action(() =>
      guard("Setup failed.", async () => {
        const { startTui } = await import("./tui/start.js");

        await startTui(null, "form");
      }),
    );

  program
    .command("test")
    .description("Check that the connection works and show which one is used")
    .action(() =>
      guard("Connection failed.", async () => {
        const { connectionString, source } = await resolveConnection(
          globals().profile,
          globals().database,
        );
        const pool = createPostgresPool(connectionString);

        try {
          const info = await checkConnection(pool);

          console.log(`Connected to "${info.database}" as ${info.user}`);
          console.log(`PostgreSQL ${info.version}, answered in ${info.ms} ms`);
          console.log(`Using: ${source}`);
        } finally {
          await pool.end();
        }
      }),
    );

  program
    .command("use [profile] [database]")
    .description("Switch the saved profile (and database) all commands use; no arguments shows it")
    .action((profileName?: string, database?: string) =>
      guard("Could not switch.", async () => {
        const config = await loadConfig();

        if (profileName) {
          if (!config.profiles[profileName]) {
            throw new Error(`Profile "${profileName}" not found. Run: querypal profile list`);
          }

          await saveConfig(setDefault(config, profileName, database));
          console.log(`Now using: ${profileName}${database ? `, database ${database}` : ""}`);
          console.log("Run: querypal test");
          return;
        }

        const current = config.defaultProfile && config.profiles[config.defaultProfile];

        if (!current) {
          console.log("No profile selected. Run: querypal use <profile>");
          return;
        }

        console.log(`Profile:  ${config.defaultProfile} (${current.user}@${current.host}:${current.port})`);
        console.log(`Database: ${config.defaultDatabase ?? current.database}${config.defaultDatabase ? " (saved override)" : " (from profile)"}`);

        if (process.env.DATABASE_URL) {
          console.log("Note: DATABASE_URL is set and takes priority over this.");
        }
      }),
    );

  const profiles = program.command("profile").description("Manage connection profiles");

  profiles
    .command("list")
    .description("List saved profiles (* marks the default)")
    .action(() =>
      guard("Could not read profiles.", async () => {
        const config = await loadConfig();
        const entries = Object.entries(config.profiles);

        if (entries.length === 0) {
          console.log("No profiles. Run: querypal init");
          return;
        }

        for (const [name, p] of entries) {
          const marker = name === config.defaultProfile ? "*" : " ";
          console.log(`${marker} ${name}  ${p.user}@${p.host}:${p.port}/${p.database}`);
        }
      }),
    );

  profiles
    .command("use <name>")
    .description("Make a profile the default")
    .action((name: string) =>
      guard("Could not switch profile.", async () => {
        const config = await loadConfig();

        if (!config.profiles[name]) {
          throw new Error(`Profile "${name}" not found. Run: querypal profile list`);
        }

        await saveConfig(setDefault(config, name));
        console.log(`Default profile: ${name}`);
      }),
    );

  profiles
    .command("remove <name>")
    .description("Delete a saved profile")
    .action((name: string) =>
      guard("Could not remove profile.", async () => {
        const config = await loadConfig();

        if (!config.profiles[name]) {
          throw new Error(`Profile "${name}" not found. Run: querypal profile list`);
        }

        await saveConfig(removeProfile(config, name));
        deleteSecret(name);
        console.log(`Removed profile: ${name}`);
      }),
    );

  program
    .command("ui")
    .description("Browse tables and search records in an interactive terminal UI")
    .action(async () => {
      const config = await loadConfig();
      const configured = globals().profile || process.env.DATABASE_URL || config.defaultProfile;

      // Nothing to connect to yet: open on the profiles list (or the form, with no profiles).
      if (!configured) {
        await guard("Could not start the UI.", async () => {
          const { startTui } = await import("./tui/start.js");

          await startTui(null, Object.keys(config.profiles).length ? "profiles" : "form");
        });
        return;
      }

      await usePool("Could not start the UI.", async (pool, source) => {
        const { startTui } = await import("./tui/start.js");

        await startTui({ pool, source });
      });
    });

  program
    .command("version")
    .description("Display the QueryPal version")
    .action(() => {
      console.log("QueryPal v0.1.0");
    });

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
    .action((tableName: string, filterText: string, options: { limit: string; schema?: string }) => {
      const separatorIndex = filterText.indexOf("=");

      if (separatorIndex <= 0) {
        console.error("Invalid filter. Use column=value, for example id=1.");
        process.exitCode = 1;
        return;
      }

      const column = filterText.slice(0, separatorIndex);
      const value = filterText.slice(separatorIndex + 1);

      const { schema, table } = resolveTable(tableName, options.schema);

      return usePool("Could not find records.", async (pool) => {
        const records = await findRecords(
          pool,
          table,
          { column, value },
          Number(options.limit),
          schema,
        );

        if (records.length === 0) {
          console.log("No matching records found.");
          return;
        }

        console.log(JSON.stringify(records, null, 2));
      });
    });

  return program;
}
