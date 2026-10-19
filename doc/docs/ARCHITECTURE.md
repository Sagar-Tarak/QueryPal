# Architecture

```text
index.ts → cli.ts → config/* → database/postgres/client.ts
             ├→ cli/data-commands.ts → database/postgres/*
             └→ tui/* → database/postgres/*
```

- `src/index.ts` starts Commander. `.env` is loaded by `pnpm dev`, not by an installed `querypal` command.
- `src/cli.ts` wires commands and resolves connections. `src/cli/data-commands.ts` handles PostgreSQL command registration and output; `src/cli/parse-column-value.ts` owns shared filter syntax.
- `src/config/` loads profiles, resolves the connection and password, and handles profile storage. Connection priority is `--profile`, `DATABASE_URL`, the default profile, then the setup screen in an interactive terminal.
- `src/database/postgres/` owns PostgreSQL queries and returns data without printing. `client.ts` creates pools and guarantees cleanup for short-lived operations. The TUI and CLI reuse the query functions.
- `src/tui/` contains the interactive browser, profile screens, and setup form. It calls the same PostgreSQL functions and manages pools it opens itself.
- `mutate-records.ts` owns update/delete validation, preview, row limits, transaction handling, concurrency checks, and private local backups. Writes require a read-write profile; read-only is the default.

Keep database policy beside the database operation that enforces it. Add a shared layer only when more than one feature needs it; do not build a generic database framework before another database adapter exists.
