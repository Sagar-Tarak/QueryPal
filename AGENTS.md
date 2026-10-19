# QueryPal contribution conventions

## Development

- Use pnpm and the scripts in `package.json` (`pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`).
- Keep TypeScript strict. Imports between project files use `.js` extensions for Node ESM.
- Let Prettier enforce formatting from `.prettierrc.json` rather than hand-formatting.
- Name files in kebab-case; use PascalCase for React components and types, camelCase for values and functions.
- Validate input at CLI and configuration boundaries. Keep SQL values parameterized and quote SQL identifiers.

## Boundaries

- `src/cli.ts` wires commands and resolves connections. `src/cli/data-commands.ts` registers database commands and prints their results; `parse-column-value.ts` owns their shared `column=value` syntax.
- `src/database/postgres/client.ts` creates pools and scopes short-lived pools with guaranteed cleanup. The TUI may retain pools returned by `openConnection` while the user browses.
- `src/database/postgres/` owns database queries and returns data; it does not print terminal output or prompt the user.
- `src/config/` owns profile persistence, credentials, and connection selection.
- `src/tui/` owns interactive screens and may reuse config and database functions.
- Keep policy beside the operation that enforces it. Add a shared abstraction only when multiple callers need it.
- Preserve read-only defaults and make database writes explicit and reviewable.

## Changes

- Add or update focused unit tests when behavior changes; integration tests that need PostgreSQL belong in `tests/integration/`.
- Update `doc/docs/ARCHITECTURE.md` when module ownership or dependency direction changes.
