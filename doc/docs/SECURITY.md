# Security Notes

QueryPal is early-stage software and should be tested against a development database before use with important data.

## Database access
- Prefer a database role with only the read permissions needed. This is the real protection; application checks do not replace it.
- Query values are parameterized.
- Schema, table, and column names are checked against `information_schema` before use, then quoted.
- `find` returns at most 100 rows (default 20).
- `update` and `delete` require a profile that explicitly allows writes. They preview matched rows, use a transaction, cap matches at 100, and save pre-change rows in private local backup files.
- A filter that matches every row requires `--all`; a filter is always required. In non-interactive use, changes are preview-only unless `--yes` is passed.
- Backups contain the directly changed rows, not changes caused by database triggers or cascading foreign keys. Backups are snapshots; a restore command is not available yet.
- Connections are read-only by default, including `DATABASE_URL` and older profiles. A saved profile can explicitly opt into read-write access; `update` and `delete` use that access, while `DATABASE_URL` stays read-only.
- Read-only connections set PostgreSQL's `default_transaction_read_only` session default. This makes PostgreSQL reject writes in each transaction; it does not replace a database role with limited permissions.
- `pnpm test:integration` checks that PostgreSQL blocks a write from a read-only pool and permits it from a read-write pool. Set `QUERYPAL_TEST_DATABASE_URL` to a disposable test database whose user can create and drop schemas.

## Passwords and connection details
- `config.json` stores host, port, database, and user only. The password is never written to it. The file and its folder are readable only by you (modes 600 and 700).
- A saved password lives in the OS keyring, and only if you opt in during `init`. Local hosts default to yes. **Remote hosts default to no**, because anything running as your user can read the keyring.
- If the keyring is unavailable, QueryPal does not fall back to a file. It uses `QUERYPAL_PASSWORD` or a hidden prompt.
- Prompts are written to stderr so piped output stays clean.
- Error messages never include the password or the connection string.
- Never commit `.env` or paste connection strings into public issues.

## Planned (not built)
Insert, backup restore, import/export, and a browsable write history are not implemented yet.

Treat the project as a prototype, not as a security-audited database client.
