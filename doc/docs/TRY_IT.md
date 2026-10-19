# Try QueryPal

QueryPal is a terminal tool for exploring a PostgreSQL database: browse tables, search rows, and manage connection profiles. It is an early test build. Reads are the default; `update` and `delete` are available after explicitly enabling writes for a saved profile.

## 1. Install (macOS or Linux)

You need **Node 22.13 or newer**.

```bash
node --version          # must say v22.13 or higher
brew install node       # macOS, if you need it (or use nvm)
```

Install from the file you were sent (run this in the folder that holds it):

```bash
npm install -g ./querypal-0.1.0.tgz
querypal --version      # 0.1.0
```

If `npm install -g` says permission denied, install to your home folder instead and make sure `~/.local/bin` is on your `PATH`:

```bash
npm install -g --prefix ~/.local ./querypal-0.1.0.tgz
```

Works on Apple Silicon and Intel Macs. A terminal at least 100 columns by 30 rows is comfortable. 80×24 works but is cramped.

## 2. Use a test database and a restricted login

Point QueryPal at a development or test database, not production. A read-only login is best for browsing. If you enable writes, use a separate restricted login with only the needed update/delete permissions. In `psql`:

```sql
CREATE ROLE querypal LOGIN PASSWORD 'choose-a-password';
GRANT CONNECT ON DATABASE your_db TO querypal;
GRANT USAGE ON SCHEMA public TO querypal;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO querypal;
```

## 3. First run

```bash
querypal init       # setup screen for a new connection
querypal ui         # the browser (opens setup if nothing is configured yet)
```

The setup screen asks for a name, host, port, database, user and password, tests the connection, then saves it. Move between fields with `↑↓` or `Tab`.

- The config file (`~/.config/querypal/config.json`) never contains the password.
- "Save the password in the OS keyring" is on by default for `localhost` and off for any other host. On a Mac this uses Keychain, and the first time it may ask for permission. Choose **Always Allow**.

## 4. Keys in `querypal ui`

| Where | Key | Does |
|---|---|---|
| Anywhere | `s` | Profiles: switch, add, edit, test, delete |
| | `q` | Quit |
| Tables | `↑↓` | Move |
| | `/` | Search tables by name (`leave appr`), or by column (`@gst`) |
| | `Enter` | Open the table's rows |
| Rows | `↑↓` `←→` | Move between rows, scroll columns |
| | `n` `p` | Next, previous page |
| | `f` | Find rows: `text`, `column~text`, or `column=value` |
| | `/` | Filter which columns are shown |
| | `Enter` | Zoom the selected row (`↑↓` scroll, `←→` other row) |
| | `c` | Column types |
| | `Esc` | Back one level |

## 5. Other commands

```bash
querypal test                   # check the connection, show which one is used
querypal tables [-s schema]
querypal describe <table>       # or schema.table
querypal find <table> col=value [-l 20]
querypal update <table> name=value --where id=7
querypal delete <table> --where id=7
querypal profile list | use <name> | remove <name>
querypal use <profile> [database]
querypal -p <profile> tables    # one command on another profile
querypal -d <database> tables   # same server, another database
```

## 6. What to test

1. Install on a clean machine, then `init` with a wrong password. Do you get a clear message?
2. Save a profile, quit, start `querypal ui` again. Does it reconnect without asking?
3. Switch between two profiles or databases with `s`.
4. Search tables (`/`, then `@column`) and search rows (`f`) on a table you know.
5. Zoom a row on a table with many columns. Is everything readable?
6. Resize the terminal while it runs.
7. Anything that looks cut off, overlapping, or confusing.

## 7. Reporting a problem

Send: what you pressed, what you expected, what happened (a screenshot helps), plus the output of `querypal --version`, `node --version`, your macOS version, and which terminal app you use (Terminal, iTerm2, ...). **Never send a password or connection string.**

## 8. Uninstall

```bash
npm uninstall -g querypal
rm -rf ~/.config/querypal
```

On a Mac, also open **Keychain Access**, search for `querypal`, and delete the entries.

## Known limits

PostgreSQL only. Reads are the default; writes require an opted-in profile. Free-text row search checks every column, so it can be slow on very large tables. No mouse support. Not security-audited: use a dev database and a restricted login (read-only unless you need writes).
