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

Profiles default to read-only. In the setup or profile edit screen, **Allow writes for this profile** opts into read-write access. Older profiles without this setting remain read-only. `update` and `delete` modify database data only through a write-enabled saved profile; `DATABASE_URL` connections remain read-only.

## `profile list`
Lists saved profiles as `name [read|readwrite]  user@host:port/database`. `*` marks the default. Passwords are never shown.

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

## `update <tableName> <change...> --where <condition>`
Updates rows matching the supplied equality conditions. Set and filter values use `column=value`; values are parameters, while table and column names are checked against PostgreSQL metadata. Repeat `--where` to combine conditions with AND.

```bash
querypal update users name=Alice status=active --where id=7
querypal update users nickname=NULL --where id=7 --yes
```

- The matching rows and proposed values are previewed before the change.
- In a terminal, QueryPal asks for confirmation. In scripts, it previews only unless `--yes` is given.
- `--limit <number>` caps matches from 1 through 100 (default 100). More matches than the cap are rejected.
- `--all` is required if the conditions match every row in the table. The row cap still applies.
- Use uppercase `NULL` for SQL `NULL`; use `'\NULL'` (single quotes in the shell) to store the literal text `NULL`.
- A private pre-change backup is written to `~/.local/share/querypal/backups` (or `QUERYPAL_BACKUP_DIR`).
- Requires a profile with **Allow writes** enabled. `DATABASE_URL` connections stay read-only.

## `delete <tableName> --where <condition>`
Deletes rows matching the supplied equality conditions. It uses the same preview, confirmation, `--yes`, `--limit`, `--all`, and write-profile rules as `update`.

```bash
querypal delete users --where id=7
querypal delete sessions --where expired=true --yes
```

The backup contains rows directly changed in the named table. PostgreSQL triggers or, for deletes, cascading foreign keys may also change other rows; those side effects are not included in this backup.

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
