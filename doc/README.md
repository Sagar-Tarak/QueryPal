# QueryPal

**A developer-friendly CLI for exploring PostgreSQL databases.**

QueryPal helps developers inspect database structure and find records without writing SQL for every routine task. It is designed to make PostgreSQL exploration approachable while keeping query behavior visible and database access safe.

> **Project status:** Early development. Reading data, connection profiles, an interactive terminal UI, and guarded `update`/`delete` commands are implemented. `insert`, backup restore, arbitrary SQL, and import/export are still planned. Check the current code and tests before assuming a planned capability is available.

## Why QueryPal?

When working with an unfamiliar database, developers often need to answer questions such as:

- Which tables are available?
- What columns does a table contain?
- Which records match a value?
- How can I inspect a database without repeatedly writing SQL?

QueryPal aims to provide simple commands for these tasks, with clear output, useful errors, and a read-only-by-default design.

## Goals

- Explore PostgreSQL from the terminal.
- Discover tables and inspect column metadata.
- Find records using simple equality filters.
- Use parameterized values rather than building SQL from user-supplied values.
- Keep credentials out of source control.
- Provide readable output and actionable errors.
- Maintain a small, testable TypeScript codebase.
- Work without requiring an AI API or external AI service.

## Current Features

| Command | Purpose | Status |
|---|---|---|
| `querypal --version` | Display the CLI version | Basic implementation |
| `querypal version` | Display the QueryPal version | Basic implementation |
| `querypal init` | Set up a connection profile (tests the connection first) | Basic implementation |
| `querypal profile list \| use <name> \| remove <name>` | Manage saved connection profiles | Basic implementation |
| `querypal tables [-s schema]` | List tables in every schema, or one schema | Basic implementation |
| `querypal describe <table> [-s schema]` | Display columns for a table (`schema.table` also works) | Basic implementation |
| `querypal find <table> <column=value> [-l n] [-s schema]` | Find records matching an equality filter | Implemented |
| `querypal update ... --where ...` / `querypal delete ... --where ...` | Preview and apply guarded writes | Implemented |

Global option: `-p, --profile <name>` runs a command against a specific profile.

The command set and output may change during early development. Insert, restore, relationship discovery, count, JSON output, query history, and saved queries are not implemented yet.

## Technology Stack

- **TypeScript** — application language
- **Node.js** — runtime
- **pnpm** — package manager
- **Commander** — command-line argument parsing
- **pg** — PostgreSQL client
- **dotenv** — local environment configuration
- **@inquirer/prompts** — setup wizard and hidden password prompt
- **@napi-rs/keyring** — optional password storage in the OS keyring
- **Vitest** — automated tests
- **tsx** — run TypeScript during development

## Requirements

- A supported Node.js version (the minimum version will be documented before a stable release)
- pnpm
- PostgreSQL access
- Docker is optional, but useful for running a local PostgreSQL instance

## Getting Started

### 1. Clone the repository

```bash
git clone <repository-url>
cd QueryPal
```

Replace `<repository-url>` with the URL of your repository.

### 2. Install dependencies

```bash
pnpm install
```

### 3. Connect a database

QueryPal needs a running PostgreSQL server, a database, and a login. It does not create these. For safety, use a login that can only read:

```sql
CREATE ROLE querypal LOGIN PASSWORD 'choose-a-password';
GRANT CONNECT ON DATABASE your_db TO querypal;
GRANT USAGE ON SCHEMA public TO querypal;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO querypal;
```

Then set up a connection profile:

```bash
pnpm dev init
```

The wizard asks for a profile name, host, port, database, user, and password, tests the connection, and saves the profile. Running any command with no profile configured, in an interactive terminal, starts the same wizard.

Profiles live in `~/.config/querypal/config.json` (or `$QUERYPAL_CONFIG_DIR`), readable only by you. **The password is never written to this file.**

Where the password comes from, in order:

1. The OS keyring, if you chose to save it during `init`. For a local host the wizard defaults to yes. For a remote host it defaults to **no** (not recommended), and you can opt in.
2. The `QUERYPAL_PASSWORD` environment variable.
3. A hidden prompt, when you are in a terminal.

Manage profiles with `profile list`, `profile use <name>`, and `profile remove <name>` (which also deletes any saved password). Use `-p <name>` to run a single command against another profile.

**Alternative: `DATABASE_URL`.** If the `DATABASE_URL` environment variable is set and you do not pass `-p`, it is used instead of a profile. This suits scripts and CI. The installed `querypal` does not read `.env` files; only `pnpm dev` loads `.env` (copy `.env.example`), for development.

Connection order: `-p` profile, then `DATABASE_URL`, then the default profile, then the setup wizard.

### 4. Start exploring

Run the CLI in development mode:

```bash
pnpm dev --help
pnpm dev tables
pnpm dev tables --schema sales
pnpm dev describe users
pnpm dev describe sales.orders
pnpm dev find users id=1 --limit 10
```

Replace `users`, `id`, and `1` with a table, column, and value from your database.

`find` supports a simple equality filter in the form `column=value`. A table name can be written `schema.table`, or use `--schema`; the default schema is `public`.

To install the `querypal` command, run `pnpm build` and link the package (for example `pnpm link --global`).

## Example Output

Listing tables:

```text
public.users
public.orders
```

Describing a table:

```text
Columns for public.users:

id              integer              Nullable: NO  Default: -
name            text                 Nullable: NO  Default: -
email           text                 Nullable: NO  Default: -
created_at      timestamp with time zone Nullable: NO  Default: now()
```

Finding a record:

```bash
pnpm dev find users id=1
```

Example output:

```json
[
  {
    "id": 1,
    "name": "Alice",
    "email": "alice@example.com",
    "created_at": "2026-10-17T10:50:35.179Z"
  }
]
```

These are illustrative examples from the development setup; your results depend on your database.

## Development Commands

```bash
# Run the CLI
pnpm dev --help

# Type-check the TypeScript project
pnpm typecheck

# Run unit tests
pnpm test
```

Run the type checker and tests before submitting a change.

## Project Structure

Current layout:

```text
QueryPal/
├── src/
│   ├── index.ts                  entry point
│   ├── cli.ts                    commands, output, error handling
│   ├── config/                   connections, profiles, passwords
│   ├── database/postgres/        queries, write safeguards, pool
│   └── tui/                      browser, profile screens, setup form
├── tests/
│   ├── unit/
│   └── integration/
├── doc/                          this documentation
├── .env.example
├── package.json
└── tsconfig.json
```

Integration coverage lives in `tests/integration/`. Database write safeguards live in `database/postgres/mutate-records.ts`.

## Safety and Security

QueryPal is intended to be read-only by default.

- Use a PostgreSQL account with only the permissions needed for exploration, especially outside local development.
- Do not hardcode credentials or commit `.env`.
- Treat database connection strings as secrets.
- Passwords are never stored in `config.json`. They go in the OS keyring only if you opt in, and remote hosts default to not saving.
- Error messages never include the password or connection string.
- Use parameterized SQL values for filters.
- Validate table and column identifiers before including them in SQL.
- Keep a documented result limit for commands that return records.
- Do not add data-modifying commands to the default exploration workflow.

Application-level checks alone are not enough to safely support arbitrary SQL. Any future arbitrary-SQL feature needs a separate policy, robust statement validation, result limits, timeouts, and database-level read-only permissions.

QueryPal is early-stage software. Review the implementation and test it against a dedicated development database before using it with important data.

## Testing

Unit tests are run with Vitest:

```bash
pnpm test
```

Type checking is run with:

```bash
pnpm typecheck
```

Integration tests against a dedicated PostgreSQL test database should be added for database behavior. Tests must not reset or modify an unknown or personal database.

## Roadmap

Done: `tables`, `describe`, `find`, schema support, readable errors, connection profiles, and password storage options.

Planned, in order:

1. `insert` and backup restore, with preview and confirmation.
2. Import and export (CSV, JSON).
3. Free-form `query` with database-enforced read-only mode by default.
4. JSON output, `count`, index and foreign-key discovery.
5. CI, release packaging, and stable compatibility documentation.

See `doc/docs/ROADMAP.md` for status.

The roadmap is aspirational. A feature should be treated as available only when it has been implemented and verified.

## Contributing

Contributions and feedback are welcome.

Before opening a change:

1. Inspect the existing implementation and relevant tests.
2. Keep changes focused and explain behavior changes.
3. Add tests for new behavior and failure cases.
4. Run `pnpm typecheck` and `pnpm test`.
5. Update the documentation when public command behavior changes.
6. Never include credentials or other secrets in a commit.

Do not assume a future roadmap feature is already part of the current CLI.

## AI-Assisted Development

AI coding assistants may be used to help develop QueryPal, but they must follow the project's safety and quality requirements:

- Inspect existing files before editing.
- Preserve working behavior unless a change is required.
- Prefer small, reviewable edits.
- Parameterize SQL values and validate identifiers.
- Preserve the read-only-by-default policy. Writes must remain opt-in per profile and preview changes before applying them.
- Add tests and report actual test results.
- Avoid unnecessary dependencies and premature abstractions.
- Explain unfamiliar TypeScript concepts so contributors can understand the code.

AI is not required to run QueryPal.

## Documentation

The detailed product and technical specification should live at:

- `docs/PROJECT_SPEC.md` — product requirements, architecture, safety, testing, roadmap, and AI coding guidelines
- `docs/ARCHITECTURE.md` — module boundaries and data flow
- `docs/COMMANDS.md` — detailed command reference
- `docs/SECURITY.md` — security policy and threat model
- `docs/ROADMAP.md` — milestones and status
- `docs/AI_GUIDELINES.md` — reusable instructions for coding agents

Create and maintain these companion documents as the project evolves.

## License

No license has been specified in this README. Add the chosen license and corresponding `LICENSE` file before inviting reuse or external contributions.
