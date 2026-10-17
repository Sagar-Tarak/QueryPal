# Security Notes

QueryPal is early-stage software and should be tested against a development database before use with important data.

## Database access
- Prefer a database role with only the read permissions needed. This is the real protection; application checks do not replace it.
- Query values are parameterized.
- Schema, table, and column names are checked against `information_schema` before use, then quoted.
- `find` returns at most 100 rows (default 20).
- There are no write commands or arbitrary SQL commands yet.

## Passwords and connection details
- `config.json` stores host, port, database, and user only. The password is never written to it. The file and its folder are readable only by you (modes 600 and 700).
- A saved password lives in the OS keyring, and only if you opt in during `init`. Local hosts default to yes. **Remote hosts default to no**, because anything running as your user can read the keyring.
- If the keyring is unavailable, QueryPal does not fall back to a file. It uses `QUERYPAL_PASSWORD` or a hidden prompt.
- Prompts are written to stderr so piped output stays clean.
- Error messages never include the password or the connection string.
- Never commit `.env` or paste connection strings into public issues.

## Planned (not built)
Editing data will be opt-in per profile, with dry-run previews, transactions, and backups. Reads will run in `READ ONLY` transactions so the database itself blocks writes on read profiles.

Treat the project as a prototype, not as a security-audited database client.
