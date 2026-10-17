# querypal

A terminal tool for exploring PostgreSQL databases. Browse tables, search rows, and manage connection profiles from a full-screen UI, or use plain commands in scripts.

> Early release. **It only reads data: there are no write commands.** Use it on a development or test database, ideally with a read-only login.

## Install

Needs **Node 22.13 or newer**.

```bash
npm install -g querypal
querypal --version
```

Or try it without installing: `npx querypal ui`.

## Start

```bash
querypal ui      # full-screen browser (opens the setup screen on first run)
querypal init    # set up a connection profile
```

The setup screen asks for host, port, database, user and password, tests the connection, then saves it. The config file (`~/.config/querypal/config.json`) never holds the password. You can save it in the OS keyring (Keychain on macOS), which defaults to on for `localhost` and off for any other host. Otherwise it is asked each time, or read from `QUERYPAL_PASSWORD`.

For safety, connect with a login that can only read:

```sql
CREATE ROLE querypal LOGIN PASSWORD 'choose-a-password';
GRANT CONNECT ON DATABASE your_db TO querypal;
GRANT USAGE ON SCHEMA public TO querypal;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO querypal;
```

## Keys in `querypal ui`

| Where | Key | Does |
|---|---|---|
| Anywhere | `s` | Profiles: switch, add, edit, test, delete |
| | `q` | Quit |
| Tables | `↑↓` | Move |
| | `/` | Search tables by name (`leave appr`), or by column name (`@gst`) |
| | `Enter` | Open the table's rows |
| Rows | `↑↓` `←→` | Move between rows, scroll columns |
| | `n` `p` | Next, previous page |
| | `f` | Find rows: `text`, `column~text`, or `column=value` |
| | `/` | Filter which columns are shown |
| | `Enter` | Zoom the selected row (`↑↓` scroll, `←→` other row) |
| | `c` | Column types |
| | `Esc` | Back one level |

## Commands

```bash
querypal test                   # check the connection and show which one is used
querypal tables [-s schema]
querypal describe <table>       # or schema.table
querypal find <table> col=value [-l 20]
querypal profile list | use <name> | remove <name>
querypal use <profile> [database]
querypal -p <profile> tables    # one command on another profile
querypal -d <database> tables   # same server, another database
```

Which connection is used, first match wins: `-p` profile, the `DATABASE_URL` environment variable, the default profile, then the setup screen.

## Limits

PostgreSQL only. Read-only. Searching text in every column checks each column, so it can be slow on very large tables. No mouse support. Not security-audited.

## Uninstall

```bash
npm uninstall -g querypal
rm -rf ~/.config/querypal
```

On macOS, also delete the `querypal` entries in Keychain Access.
