# Roadmap

## Done
- [x] Initial TypeScript CLI and PostgreSQL connection
- [x] List tables, describe columns, find records with one equality filter
- [x] `--schema` and `schema.table` support, `find --limit`
- [x] Readable connection, permission, and query error messages
- [x] Connection profiles: `init`, `profile list|use|remove`, `--profile`
- [x] Password handling: OS keyring (opt-in, remote hosts default to no), `QUERYPAL_PASSWORD`, hidden prompt
- [x] `build` script and `bin` entry
- [x] Unit tests
- [x] Integration tests using an explicitly configured test database
- [x] Terminal UI: table list, row browser, schema panel

## Editing data
- [x] Per-profile access level (`read` default, `readwrite` opt-in); read-only sessions use PostgreSQL's transaction read-only default
- [x] Integration check for PostgreSQL read-only enforcement (`QUERYPAL_TEST_DATABASE_URL=... pnpm test:integration`)
- [ ] `insert` with preview, confirmation, transaction, and backup
- [ ] Restore a saved update/delete backup
- [x] CLI `update` and `delete` with preview, row cap, confirmation, transaction, and private backup of directly affected rows
- [x] `update` and `delete` require a filter; whole-table matches also require `--all`
- [ ] Local history of executed writes (no passwords)
- [ ] `import` and `export` (CSV, JSON), `upsert`
- [ ] Free-form `query`, read-only by default, with row cap and timeout
- [ ] Schema changes (columns, tables, indexes)
- [ ] Inline editing in the terminal UI

## Later
- [ ] `--json` output, `count`
- [ ] Foreign-key and index discovery
- [ ] CI workflow and release packaging
