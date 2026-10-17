# Architecture

```
index.ts → cli.ts → config/* (which database, which password) → database/postgres/* (queries) → output
```

1. `src/index.ts` starts Commander. It does not read `.env`: only `pnpm dev` loads one (`tsx --env-file-if-exists=.env`), so an installed `querypal` never picks up a `.env` from the folder it runs in.
2. `src/cli.ts` defines commands and owns the lifecycle: `guard` prints failures in one format, `withPool` resolves the connection, opens a pool, runs the command, and always closes the pool.
3. `src/config/` decides what to connect to:
   - `connection.ts`: order is `--profile`, `DATABASE_URL`, default profile, setup wizard.
   - `profiles.ts`: reads and writes `config.json`, builds the connection string (URL-encoded).
   - `password.ts`: keyring, then `QUERYPAL_PASSWORD`, then a hidden prompt.
   - `keyring.ts`: thin wrapper over `@napi-rs/keyring`. It never throws, so a missing keyring is a fallback, not a crash.
   - `setup.ts`: the `init` wizard.
4. `src/database/postgres/` has one file per query. Each takes a `Pool` and returns data. It never prints.

Rules:
- `cli.ts` contains no SQL.
- `database/postgres/*` contains no printing, so the same functions can serve a future terminal UI.
- Output formatting is still inline in `cli.ts`; a separate `output/` module will be added when JSON or table output arrives.

Planned: a `safety/` module (access level, identifier validation, row caps) that every write must pass through, and a `tui/` front end that calls the same database functions as the commands.

Keep abstractions proportional to current needs; do not introduce a generic multi-database framework before a second adapter exists.
