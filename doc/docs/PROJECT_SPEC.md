# QueryPal — Product and Technical Specification

## Summary
QueryPal is a beginner-friendly, read-only-first CLI for exploring PostgreSQL databases. It should help developers inspect schemas and find records without writing SQL for every routine task, while keeping behavior visible and predictable.

## Target users
Backend and frontend developers who need to inspect a database but may not know the PostgreSQL catalog queries or SQL syntax required for common tasks.

## Product principles
- PostgreSQL first.
- Terminal only. Commands for scripts, a TUI for interactive use, both on the same core.
- Read-only by default; writes are opt-in per profile.
- No AI service required at runtime.
- Parameterized values and metadata-validated identifiers.
- Useful errors and bounded result sets.
- Keep the code understandable and maintainable.

## Current prototype commands
- `querypal version`
- `querypal init`
- `querypal profile list | use <name> | remove <name>`
- `querypal tables [--schema <name>]`
- `querypal describe <tableName> [--schema <name>]`
- `querypal find <tableName> <column=value> [--limit <number>] [--schema <name>]`
- Global: `--profile <name>`

The prototype is not a stable release and does not implement every roadmap feature.

## Direction
QueryPal is meant to become a terminal tool for exploring **and editing** PostgreSQL data. A terminal UI is the main interactive front end; the commands stay for scripts. Editing is opt-in per profile and always previews first. See `ROADMAP.md`.

## Technical stack
TypeScript, Node.js, pnpm, Commander, `pg`, dotenv, tsx, TypeScript compiler, Vitest.

## Configuration
Connections come from saved profiles (`~/.config/querypal/config.json`, created by `querypal init`) or from `DATABASE_URL`. Order: `--profile`, `DATABASE_URL`, default profile, setup wizard. Passwords are never stored in the config file; see `SECURITY.md`. Do not commit secrets. Prefer a restricted PostgreSQL role.

## Safety requirements
- Do not concatenate filter values into SQL.
- Validate table and column names against PostgreSQL metadata.
- Limit result counts.
- No write commands or arbitrary SQL yet. When added: per-profile opt-in, dry-run preview, one transaction, backup of changed rows, and `update`/`delete` only with a filter.
- Avoid exposing credentials in errors.

## Architecture
- `src/index.ts`: process entry point. `.env` is loaded only by `pnpm dev`, not by the installed command.
- `src/cli.ts`: command registration and lifecycle.
- `src/config/`: profiles, password lookup, keyring, setup wizard.
- `src/database/postgres/`: PostgreSQL client and operations.
- `tests/unit/`: fast automated tests.
- `docs/`: project decisions and command/security documentation.

## Definition of done
A change should have focused code, tests for relevant behavior, updated documentation when public behavior changes, and passing `pnpm typecheck` and `pnpm test` results recorded by the contributor.
