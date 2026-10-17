# Command Reference

Run commands in development with `pnpm dev`, or as `querypal` after `pnpm build` and linking.

Global option: `-p, --profile <name>` uses a saved connection profile for this command.

Connection order: `-p` profile, then `DATABASE_URL`, then the default profile, then the setup wizard (interactive terminals only). In a script with nothing configured, commands fail with `No database configured. Run: querypal init, or set DATABASE_URL.`

## `version`
Prints the QueryPal version.

## `init`
Interactive setup. Asks for profile name, host, port, database, user, and password, runs `SELECT 1` to test the connection, then saves the profile. If the test fails, it shows the reason and asks whether to save anyway (default: no).

After the test it asks whether to save the password in the OS keyring. Default is yes for `localhost`, `127.0.0.1`, `::1`, and **no** for any other host. If the keyring is unavailable, the profile is saved to prompt for the password each time.

The first profile becomes the default.

## `profile list`
Lists saved profiles as `name  user@host:port/database`. `*` marks the default. Passwords are never shown.

## `profile use <name>`
Makes a profile the default.

## `profile remove <name>`
Deletes a profile and its saved keyring password, if any.

## `tables`
Lists base tables in every schema except `pg_catalog` and `information_schema`.

Options:
- `-s, --schema <name>`: only list tables in this schema.

## `describe <tableName>`
Shows column name, data type, nullability, and default value for a table or view. `tableName` can be `schema.table`.

Options:
- `-s, --schema <name>`: schema of the table (default: `public`). A `schema.table` name takes priority.

## `find <tableName> <column=value>`
Finds rows matching a single equality condition. The filter splits at the first `=`. Values are bound as query parameters. The schema, table, and column are checked against PostgreSQL metadata first.

Options:
- `-l, --limit <number>`: number of rows, from 1 through 100 (default: 20).
- `-s, --schema <name>`: schema of the table (default: `public`).

## Password lookup
For a saved profile: the OS keyring (only if the profile opted in), then the `QUERYPAL_PASSWORD` environment variable, then a hidden prompt. Without a terminal and without the variable, the command fails with `No password available. Set QUERYPAL_PASSWORD.`

## Examples
```bash
pnpm dev init
pnpm dev profile list
pnpm dev profile use staging
pnpm dev -p staging tables
pnpm dev tables --schema sales
pnpm dev describe sales.orders
pnpm dev find users id=1
pnpm dev find users name=Alice --limit 10
QUERYPAL_PASSWORD=secret pnpm dev tables
```
