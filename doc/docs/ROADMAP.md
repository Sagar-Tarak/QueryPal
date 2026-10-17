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

## Next
- [ ] Integration tests using an explicitly configured test database (Docker PostgreSQL)
- [ ] Terminal UI: table list, row browser, schema panel (read-only first)

## Editing data
- [ ] Per-profile access level (`read` default, `readwrite` opt-in); reads run in a `READ ONLY` transaction
- [ ] `insert`, `update`, `delete` with dry-run preview, row count, confirmation, one transaction, and a backup of affected rows
- [ ] `update` and `delete` require a filter; changing every row needs an explicit flag
- [ ] Local history of executed writes (no passwords)
- [ ] `import` and `export` (CSV, JSON), `upsert`
- [ ] Free-form `query`, read-only by default, with row cap and timeout
- [ ] Schema changes (columns, tables, indexes)
- [ ] Inline editing in the terminal UI

## Later
- [ ] `--json` output, `count`
- [ ] Foreign-key and index discovery
- [ ] CI workflow and release packaging
