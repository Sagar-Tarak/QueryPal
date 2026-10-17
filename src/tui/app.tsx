import { Box, Text, useApp, useInput, useWindowSize } from "ink";
import type { Pool } from "pg";
import { useEffect, useMemo, useState } from "react";
import { checkConnection, type ConnectionInfo } from "../database/postgres/check-connection.js";
import { listColumnIndex } from "../database/postgres/column-index.js";
import { describeTable, type ColumnInfo } from "../database/postgres/describe-table.js";
import { explainError } from "../database/postgres/errors.js";
import { listRows } from "../database/postgres/list-rows.js";
import { searchRecords } from "../database/postgres/search-records.js";
import { listTables, type DatabaseTable } from "../database/postgres/tables.js";
import { formatDetail, formatTable, visibleWindow } from "./format.js";
import { Panel } from "./panel.js";
import { columnMatches, matchTables, parseSearch } from "./search.js";
import { StatusBar } from "./status-bar.js";
import { theme } from "./theme.js";

interface Page {
  records: Record<string, unknown>[];
  offset: number;
  hasMore: boolean;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const CONNECTION_HEIGHT = 5;

const PROMPTS = {
  tables: "search tables (words, or @column)",
  columns: "filter columns",
  search: "find rows (text · column~text · column=value)",
} as const;

export function App({
  pool,
  source = "",
  onProfiles,
}: {
  pool: Pool;
  source?: string;
  onProfiles?: () => void;
}) {
  const { exit } = useApp();
  const { columns: termColumns, rows: termRows } = useWindowSize();
  const [info, setInfo] = useState<ConnectionInfo | null>(null);
  const [tables, setTables] = useState<DatabaseTable[]>([]);
  const [columnIndex, setColumnIndex] = useState<Record<string, string[]>>({});
  const [tableFilter, setTableFilter] = useState("");
  const [columnFilter, setColumnFilter] = useState("");
  const [selected, setSelected] = useState(0);
  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [focus, setFocus] = useState<"tables" | "data">("tables");
  const [view, setView] = useState<"rows" | "columns" | "detail">("rows");
  const [page, setPage] = useState<Page | null>(null);
  const [cursor, setCursor] = useState(0);
  const [firstColumn, setFirstColumn] = useState(0);
  const [detailScroll, setDetailScroll] = useState(0);
  const [typeScroll, setTypeScroll] = useState(0);
  const [searchLabel, setSearchLabel] = useState("");
  const [searchText, setSearchText] = useState("");
  const [typing, setTyping] = useState<keyof typeof PROMPTS | null>(null);
  const [error, setError] = useState("");

  const visibleTables = useMemo(
    () => matchTables(tables, columnIndex, tableFilter),
    [tables, columnIndex, tableFilter],
  );
  const table = visibleTables[selected];

  // Layout: left column (connection + tables), right column (rows + row detail), status line.
  // One terminal row stays unused (Ink redraws cleanly below full height), one is the status line.
  const bodyHeight = Math.max(12, termRows - 2);
  const leftWidth = clamp(Math.floor(termColumns * 0.3), 26, 44);
  const rightWidth = Math.max(30, termColumns - leftWidth);
  const zoom = view === "detail";
  // The rows panel keeps its size while a row is zoomed, so the page size (and which rows
  // are loaded) never changes just because the detail panel grows.
  const normalDetailHeight = clamp(Math.floor(bodyHeight * 0.35), 6, 14);
  const detailHeight = zoom ? bodyHeight : normalDetailHeight;
  const rowsHeight = bodyHeight - normalDetailHeight;
  const tablesHeight = bodyHeight - CONNECTION_HEIGHT;
  const pageSize = clamp(rowsHeight - 3, 3, 99);
  const cellsWidth = rightWidth - 4;
  const detailRoom = detailHeight - 2;
  const typeRoom = rowsHeight - 2;

  // After a resize the page can hold more rows than fit; show what fits, page from there.
  const fetched = page ? page.records.slice(0, pageSize) : [];
  const hasMore = !!page && (page.hasMore || fetched.length < page.records.length);
  // The column filter hides columns from view; it never changes what is fetched.
  const shown = columnFilter
    ? fetched.map((r) => Object.fromEntries(Object.entries(r).filter(([name]) => columnMatches(name, columnFilter))))
    : fetched;
  const record = shown[cursor];
  const grid = formatTable(shown, cellsWidth, firstColumn);
  const entries = record ? formatDetail(record) : [];

  useEffect(() => {
    checkConnection(pool).then(setInfo, (e) => setError(explainError(e)));
    listTables(pool).then(setTables, (e) => setError(explainError(e)));
    // Only needed for "@column" table search, so a failure just disables that.
    listColumnIndex(pool).then(setColumnIndex, () => undefined);
  }, [pool]);

  useEffect(() => {
    setPage(null);
    setCursor(0);
    setFirstColumn(0);
    setSearchLabel("");
    setColumnFilter("");
    setView("rows");
    setColumns([]);

    if (!table) {
      return;
    }

    let stale = false;

    describeTable(pool, table.name, table.schema).then(
      (found) => !stale && setColumns(found),
      (e) => !stale && setError(explainError(e)),
    );

    return () => {
      stale = true;
    };
  }, [pool, table?.schema, table?.name]);

  useEffect(() => setDetailScroll(0), [cursor, page, view]);
  useEffect(() => setTypeScroll(0), [table?.schema, table?.name, columnFilter, view]);

  const showPage = (rows: Record<string, unknown>[], offset: number, label: string) => {
    setPage({ records: rows.slice(0, pageSize), offset, hasMore: rows.length > pageSize });
    setCursor(0);
    setSearchLabel(label);
    setView("rows");
  };

  const loadPage = async (offset: number) => {
    if (!table) {
      return;
    }

    try {
      showPage(await listRows(pool, table.name, table.schema, pageSize + 1, offset), offset, "");
    } catch (e) {
      setError(explainError(e));
    }
  };

  const runSearch = async (text: string, offset = 0) => {
    const parsed = parseSearch(text, columns.map((c) => c.name));

    if (!table || "error" in parsed) {
      setError("error" in parsed ? parsed.error : "");
      return;
    }

    try {
      const rows = await searchRecords(pool, table.name, parsed.filter, pageSize + 1, table.schema, offset);

      showPage(rows, offset, text.trim());
    } catch (e) {
      setError(explainError(e));
    }
  };

  // Next and previous page of whatever is on screen: the search results, or the plain table.
  const goToPage = (offset: number) => (searchLabel ? runSearch(searchLabel, offset) : loadPage(offset));

  const openRows = () => {
    setFocus("data");

    if (!page) {
      void loadPage(0);
    }
  };

  const fields = {
    tables: [tableFilter, setTableFilter],
    columns: [columnFilter, setColumnFilter],
    search: [searchText, setSearchText],
  } as const;

  useInput((input, key) => {
    setError("");

    if (typing) {
      const [text, set] = fields[typing];
      const edit = (next: string) => {
        set(next);
        setSelected(0);
        setFirstColumn(0);
      };

      if (key.return) {
        if (typing === "search") {
          void runSearch(searchText);
        }

        setTyping(null);
      } else if (key.escape) {
        edit("");
        setTyping(null);
      } else if (key.backspace || key.delete) {
        edit(text.slice(0, -1));
      } else if (input && !key.ctrl && !key.meta) {
        edit(text + input);
      }

      return;
    }

    if (input === "q") {
      exit();
    } else if (input === "s" && onProfiles) {
      onProfiles();
    } else if (key.tab) {
      if (focus === "tables" && table) {
        openRows();
      } else {
        setFocus("tables");
      }
    } else if (input === "2") {
      setFocus("tables");
    } else if (input === "3" && table) {
      openRows();
    } else if (input === "f" && table) {
      setSearchText("");
      setTyping("search");
      setFocus("data");
    } else if (focus === "tables") {
      if (key.downArrow) {
        setSelected((s) => Math.min(s + 1, visibleTables.length - 1));
      } else if (key.upArrow) {
        setSelected((s) => Math.max(s - 1, 0));
      } else if (input === "/") {
        setTyping("tables");
      } else if (key.return && table) {
        openRows();
      } else if (key.escape) {
        setTableFilter("");
      }
    } else if (key.escape) {
      if (view !== "rows") {
        setView("rows");
      } else if (searchLabel) {
        void loadPage(0);
      } else if (columnFilter) {
        setColumnFilter("");
        setFirstColumn(0);
      } else {
        setFocus("tables");
      }
    } else if (zoom) {
      // zoomed row: up/down scroll its columns, left/right move to the neighbouring row
      const maxScroll = Math.max(0, entries.length - detailRoom);

      if (key.downArrow) {
        setDetailScroll((s) => Math.min(s + 1, maxScroll));
      } else if (key.upArrow) {
        setDetailScroll((s) => Math.max(s - 1, 0));
      } else if (key.pageDown) {
        setDetailScroll((s) => Math.min(s + detailRoom, maxScroll));
      } else if (key.pageUp) {
        setDetailScroll((s) => Math.max(s - detailRoom, 0));
      } else if (key.rightArrow) {
        setCursor((c) => Math.min(c + 1, shown.length - 1));
      } else if (key.leftArrow) {
        setCursor((c) => Math.max(c - 1, 0));
      } else if (key.return) {
        setView("rows");
      }
    } else if (view === "columns" && (key.downArrow || key.upArrow || key.pageDown || key.pageUp)) {
      const max = Math.max(0, typeList.length - typeRoom);

      setTypeScroll((s) =>
        key.downArrow
          ? Math.min(s + 1, max)
          : key.upArrow
            ? Math.max(s - 1, 0)
            : key.pageDown
              ? Math.min(s + typeRoom, max)
              : Math.max(s - typeRoom, 0),
      );
    } else if (input === "/") {
      setTyping("columns");
    } else if (input === "c") {
      setView(view === "columns" ? "rows" : "columns");
    } else if (key.return && record) {
      setView("detail");
    } else if (key.downArrow) {
      setCursor((c) => Math.min(c + 1, Math.max(shown.length - 1, 0)));
    } else if (key.upArrow) {
      setCursor((c) => Math.max(c - 1, 0));
    } else if (key.rightArrow || input === "l") {
      setFirstColumn((f) => Math.min(f + 1, Math.max((grid?.total ?? 1) - 1, 0)));
    } else if (key.leftArrow || input === "h") {
      setFirstColumn((f) => Math.max(0, f - 1));
    } else if ((input === "n" || key.pageDown) && page && hasMore) {
      void goToPage(page.offset + fetched.length);
    } else if ((input === "p" || key.pageUp) && page && page.offset > 0) {
      void goToPage(Math.max(0, page.offset - pageSize));
    }
  });

  const { start, end } = visibleWindow(visibleTables.length, selected, tablesHeight - 2);
  const rowSelectionColor = focus === "data" ? theme.selectedBackground : theme.idleSelectedBackground;
  const offset = page?.offset ?? 0;
  const typeList = columns.filter((c) => columnMatches(c.name, columnFilter));
  // Only as many rows as fit: more would be squeezed together and drawn on top of each other.
  const scrollTypes = focus === "data" && view === "columns";
  const typeRows = scrollTypes
    ? typeList.slice(typeScroll, typeScroll + typeRoom)
    : typeList.slice(0, typeRoom);
  // two spaces after the longest name and type, so columns never touch
  const nameWidth = Math.max(0, ...typeList.map((c) => c.name.length)) + 2;
  const typeWidth = Math.max(0, ...typeList.map((c) => c.dataType.length)) + 2;
  const typeCount =
    typeRows.length === typeList.length
      ? `${typeList.length}`
      : scrollTypes
        ? `${typeScroll + 1}–${typeScroll + typeRows.length}/${typeList.length}`
        : `${typeRows.length} of ${typeList.length}`;

  const rowsTitle = !table
    ? "[3] Rows"
    : view === "columns" || focus === "tables"
      ? `[3] ${table.schema}.${table.name} · column types ${typeCount}${columnFilter ? ` · filter "${columnFilter}"` : ""}`
      : [
          `[3] ${table.schema}.${table.name}`,
          searchLabel ? `find ${searchLabel}` : "",
          fetched.length ? `rows ${offset + 1}–${offset + fetched.length}${hasMore ? "+" : ""}` : "",
          columnFilter ? `columns "${columnFilter}"` : "",
          grid && grid.total > 1 ? `cols ${grid.first + 1}–${grid.first + grid.shown}/${grid.total}` : "",
        ]
          .filter(Boolean)
          .join(" · ");

  const detailRows = zoom
    ? entries.slice(detailScroll, detailScroll + detailRoom)
    : entries.slice(0, detailRoom);
  const detailTitle = !record
    ? "[4] Row"
    : [
        `[4] Row ${offset + cursor + 1}`,
        entries.length > detailRows.length
          ? zoom
            ? `columns ${detailScroll + 1}–${detailScroll + detailRows.length}/${entries.length}`
            : `${detailRows.length} of ${entries.length} columns · enter to zoom`
          : "",
      ]
        .filter(Boolean)
        .join(" · ");

  const hints: [string, string][] =
    focus === "tables"
      ? [["↑↓", "move"], ["enter", "rows"], ["/", "search tables"], ["f", "find rows"], ["s", "profiles"], ["q", "quit"]]
      : zoom
        ? [["↑↓", "scroll"], ["←→", "other row"], ["esc", "back"], ["q", "quit"]]
        : view === "columns"
          ? [["↑↓", "scroll"], ["/", "filter"], ["c", "rows"], ["esc", "back"], ["q", "quit"]]
          : [["↑↓", "row"], ["←→", "scroll"], ["enter", "zoom"], ["n/p", "page"], ["f", "find rows"], ["/", "columns"], ["c", "types"], ["esc", "back"], ["q", "quit"]];

  return (
    <Box flexDirection="column" width={termColumns} height={termRows - 1}>
      <Box height={bodyHeight}>
        <Box flexDirection="column" width={leftWidth}>
          <Panel title="[1] Connection" width={leftWidth} height={CONNECTION_HEIGHT}>
            <Text bold wrap="truncate-end">
              {info ? info.database : "connecting…"}
            </Text>
            <Text dimColor wrap="truncate-end">
              {info ? `${info.user} · PostgreSQL ${info.version}` : ""}
            </Text>
            <Text dimColor wrap="truncate-end">
              {source}
            </Text>
          </Panel>

          <Panel
            title={`[2] Tables ${tableFilter ? `${visibleTables.length}/${tables.length} /${tableFilter}` : tables.length}`}
            width={leftWidth}
            height={tablesHeight}
            focused={focus === "tables"}
          >
            {visibleTables.length === 0 && <Text dimColor>No tables found.</Text>}
            {visibleTables.slice(start, end).map((t, i) => {
              const isSelected = start + i === selected;

              return (
                <Text
                  key={`${t.schema}.${t.name}`}
                  wrap="truncate-end"
                  backgroundColor={isSelected ? rowSelectionColor : undefined}
                  color={isSelected ? theme.selectedText : undefined}
                >
                  {t.schema === "public" ? "" : `${t.schema}.`}
                  {t.name}
                </Text>
              );
            })}
          </Panel>
        </Box>

        <Box flexDirection="column" width={rightWidth}>
          {!zoom && (
            <Panel title={rowsTitle} width={rightWidth} height={rowsHeight} focused={focus === "data"}>
              {(view === "columns" || focus === "tables") &&
                typeRows.map((c) => (
                  <Text key={c.name} wrap="truncate-end">
                    <Text bold>{c.name.padEnd(nameWidth)}</Text>
                    <Text color={theme.accent}>{c.dataType.padEnd(typeWidth)}</Text>
                    <Text dimColor>{c.nullable ? "null" : "not null"}</Text>
                    {c.defaultValue ? <Text dimColor>{`  = ${c.defaultValue}`}</Text> : null}
                  </Text>
                ))}
              {(view === "columns" || focus === "tables") && columnFilter && typeList.length === 0 && (
                <Text dimColor>No column matches "{columnFilter}".</Text>
              )}

              {focus === "data" && view === "rows" && !page && <Text dimColor>Loading rows…</Text>}
              {focus === "data" && view === "rows" && page && fetched.length === 0 && (
                <Text dimColor>{searchLabel ? "No matching records found." : "This table is empty."}</Text>
              )}
              {focus === "data" && view === "rows" && fetched.length > 0 && !grid && (
                <Text dimColor>No column matches "{columnFilter}". Esc clears the filter.</Text>
              )}
              {focus === "data" && view === "rows" && grid && (
                <>
                  <Text bold color={theme.accent} wrap="truncate-end">
                    {grid.header.join(" ")}
                  </Text>
                  {grid.rows.map((cells, i) =>
                    i === cursor ? (
                      <Text key={i} wrap="truncate-end" backgroundColor={rowSelectionColor} color={theme.selectedText}>
                        {cells.map((c) => c.text).join(" ")}
                      </Text>
                    ) : (
                      <Text key={i} wrap="truncate-end">
                        {cells.map((c, j) => (
                          <Text key={j} color={c.kind === "text" ? undefined : theme[c.kind]}>
                            {j > 0 ? " " : ""}
                            {c.text}
                          </Text>
                        ))}
                      </Text>
                    ),
                  )}
                </>
              )}
            </Panel>
          )}

          <Panel title={detailTitle} width={rightWidth} height={detailHeight} focused={zoom}>
            {!record && <Text dimColor>{focus === "tables" ? "Select a table, then press enter." : ""}</Text>}
            {detailRows.map((entry, i) => (
              <Text key={i} wrap={zoom ? "wrap" : "truncate-end"}>
                <Text color={theme.accent}>{entry.key}</Text>
                {"  "}
                <Text color={entry.kind === "text" ? undefined : theme[entry.kind]}>{entry.value}</Text>
              </Text>
            ))}
          </Panel>
        </Box>
      </Box>

      <StatusBar
        hints={hints}
        error={error}
        prompt={typing ? `${PROMPTS[typing]}: ${fields[typing][0]}` : undefined}
      />
    </Box>
  );
}
