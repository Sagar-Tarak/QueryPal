import { Box, Text, useApp, useInput, useWindowSize } from "ink";
import type { Pool } from "pg";
import { useEffect, useMemo, useRef, useState } from "react";
import { checkConnection, type ConnectionInfo } from "../database/postgres/check-connection.js";
import { listColumnIndex } from "../database/postgres/column-index.js";
import {
  describeTable,
  primaryKeyColumns,
  type ColumnInfo,
} from "../database/postgres/describe-table.js";
import { explainError } from "../database/postgres/errors.js";
import { listRows } from "../database/postgres/list-rows.js";
import type { SortColumn } from "../database/postgres/keyset.js";
import {
  mutateRecords,
  parseMutationValue,
  type Mutation,
} from "../database/postgres/mutate-records.js";
import { searchRecords } from "../database/postgres/search-records.js";
import { listTables, type DatabaseTable } from "../database/postgres/tables.js";
import { cellText, formatDetail, formatTable, visibleWindow } from "./format.js";
import { Panel } from "./panel.js";
import { columnMatches, matchTables, parseSearch } from "./search.js";
import { StatusBar } from "./status-bar.js";
import { theme } from "./theme.js";

interface Page {
  records: Record<string, unknown>[];
  offset: number;
  hasMore: boolean;
  keyset: boolean;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const CONNECTION_HEIGHT = 5;

const PROMPTS = {
  tables: "search tables (words, or @column)",
  columns: "filter columns",
  search: "find rows (text · column~text · column=value)",
} as const;

interface RowEditor {
  stage: "field" | "value";
  selected: number;
  value: string;
  scroll: number;
}

export function App({
  pool,
  source = "",
  accessLevel = "read",
  onProfiles,
}: {
  pool: Pool;
  source?: string;
  accessLevel?: "read" | "readwrite";
  onProfiles?: () => void;
}) {
  const { exit } = useApp();
  const { columns: termColumns, rows: termRows } = useWindowSize();
  const [info, setInfo] = useState<ConnectionInfo | null>(null);
  const [tables, setTables] = useState<DatabaseTable[]>([]);
  const [tablesLoaded, setTablesLoaded] = useState(false);
  const [columnIndex, setColumnIndex] = useState<Record<string, string[]>>({});
  const [tableFilter, setTableFilter] = useState("");
  const [columnFilter, setColumnFilter] = useState("");
  const [selected, setSelected] = useState(0);
  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [primaryKeyNames, setPrimaryKeyNames] = useState<string[] | null>(null);
  const [focus, setFocus] = useState<"tables" | "data">("tables");
  const [view, setView] = useState<"rows" | "columns" | "detail">("rows");
  const [helpOpen, setHelpOpen] = useState(false);
  const [page, setPage] = useState<Page | null>(null);
  const [cursor, setCursor] = useState(0);
  const [firstColumn, setFirstColumn] = useState(0);
  const [detailScroll, setDetailScroll] = useState(0);
  const [typeScroll, setTypeScroll] = useState(0);
  const [searchLabel, setSearchLabel] = useState("");
  const [searchText, setSearchText] = useState("");
  const [typing, setTyping] = useState<keyof typeof PROMPTS | null>(null);
  const [rowEditor, setRowEditor] = useState<RowEditor | null>(null);
  const [sortOrder, setSortOrder] = useState<SortColumn | null>(null);
  const [sortPicker, setSortPicker] = useState<{
    selected: number;
    direction: "ASC" | "DESC";
    scroll: number;
  } | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [error, setError] = useState("");
  const pageRequest = useRef(0);
  const columnIndexRequest = useRef<Promise<Record<string, string[]>> | null>(null);
  const primaryKeyRequest = useRef<{ table: string; promise: Promise<string[]> } | null>(null);
  const resolveConfirmation = useRef<((accepted: boolean) => void) | null>(null);

  const loadPrimaryKeyNames = (schema: string, tableName: string) => {
    const tableKey = JSON.stringify([schema, tableName]);

    if (primaryKeyRequest.current?.table === tableKey) return primaryKeyRequest.current.promise;

    const promise = primaryKeyColumns(pool, tableName, schema);
    primaryKeyRequest.current = { table: tableKey, promise };
    return promise;
  };

  const visibleTables = useMemo(
    () => matchTables(tables, columnIndex, tableFilter),
    [tables, columnIndex, tableFilter],
  );
  const table = visibleTables[selected];

  // Layout: left column (connection + tables), right column (rows + row detail), status line.
  // One terminal row stays unused (Ink redraws cleanly below full height), one is the status line.
  const bodyHeight = Math.max(8, termRows - 2);
  const leftWidth = Math.min(
    clamp(Math.floor(termColumns * 0.3), 20, 40),
    Math.max(16, termColumns - 24),
  );
  const rightWidth = Math.max(1, termColumns - leftWidth);
  const zoom = view === "detail" || helpOpen || rowEditor !== null || sortPicker !== null;
  // The rows panel keeps its size while a row is zoomed, so the page size (and which rows
  // are loaded) never changes just because the detail panel grows.
  const normalDetailHeight = clamp(
    Math.floor(bodyHeight * 0.35),
    4,
    Math.min(14, Math.floor(bodyHeight * 0.6)),
  );
  const detailHeight = zoom ? bodyHeight : normalDetailHeight;
  const rowsHeight = Math.max(4, bodyHeight - normalDetailHeight);
  const tablesHeight = bodyHeight - CONNECTION_HEIGHT;
  const pageSize = clamp(rowsHeight - 3, 3, 99);
  const cellsWidth = Math.max(1, rightWidth - 4);
  const detailRoom = detailHeight - 2;
  const typeRoom = rowsHeight - 2;

  // After a resize the page can hold more rows than fit; show what fits, page from there.
  const fetched = page ? page.records.slice(0, pageSize) : [];
  const hasMore = !!page && (page.hasMore || fetched.length < page.records.length);
  // The column filter hides columns from view; it never changes what is fetched.
  const shown = columnFilter
    ? fetched.map((r) =>
        Object.fromEntries(Object.entries(r).filter(([name]) => columnMatches(name, columnFilter))),
      )
    : fetched;
  const record = shown[cursor];
  const fullRecord = fetched[cursor];
  const primaryKeys = columns.filter((column) => primaryKeyNames?.includes(column.name));
  const validPrimaryKeyNames = (primaryKeyNames ?? []).filter((name) =>
    columns.some((column) => column.name === name),
  );
  const sortableColumns = columns.filter(
    (column) => !["json", "jsonb", "xml"].includes(column.dataType),
  );
  const orderBy: SortColumn[] = validPrimaryKeyNames.length
    ? [
        ...(sortOrder ? [sortOrder] : []),
        ...validPrimaryKeyNames
          .filter((name) => name !== sortOrder?.column)
          .map((column) => ({ column, direction: "ASC" as const })),
      ]
    : [];
  const cursorFor = (row: Record<string, unknown>) => orderBy.map(({ column }) => row[column]);
  const makeOrder = (keys: string[], sort = sortOrder): SortColumn[] => {
    const validKeys = keys.filter((name) => columns.some((column) => column.name === name));
    return validKeys.length
      ? [
          ...(sort ? [sort] : []),
          ...validKeys
            .filter((name) => name !== sort?.column)
            .map((column) => ({ column, direction: "ASC" as const })),
        ]
      : [];
  };
  const canMutate = accessLevel === "readwrite" && primaryKeys.length > 0 && !!fullRecord;
  const grid = formatTable(shown, cellsWidth, firstColumn);
  const entries = record ? formatDetail(record) : [];

  useEffect(() => {
    let stale = false;

    checkConnection(pool).then(
      (info) => !stale && setInfo(info),
      (e) => !stale && setError(explainError(e)),
    );
    listTables(pool).then(
      (found) => {
        if (!stale) {
          setTables(found);
          setTablesLoaded(true);
        }
      },
      (e) => !stale && setError(explainError(e)),
    );
    return () => {
      stale = true;
    };
  }, [pool]);

  useEffect(() => {
    if (!tableFilter.trim().startsWith("@") || columnIndexRequest.current) return;

    columnIndexRequest.current = listColumnIndex(pool);
    void columnIndexRequest.current.then(setColumnIndex, () => undefined);
  }, [pool, tableFilter]);

  useEffect(() => {
    setPage(null);
    setCursor(0);
    setFirstColumn(0);
    setSearchLabel("");
    setColumnFilter("");
    setView("rows");
    setColumns([]);
    setPrimaryKeyNames(null);
    setSortOrder(null);
    pageRequest.current++;

    if (!table) {
      return;
    }

    let stale = false;

    describeTable(pool, table.name, table.schema).then(
      (found) => !stale && setColumns(found),
      (e) => !stale && setError(explainError(e)),
    );
    loadPrimaryKeyNames(table.schema, table.name).then(
      (names) => !stale && setPrimaryKeyNames(names),
      () => !stale && setPrimaryKeyNames([]),
    );

    return () => {
      stale = true;
      pageRequest.current++;
    };
  }, [pool, table?.schema, table?.name]);

  useEffect(() => setDetailScroll(0), [cursor, page, view]);
  useEffect(() => setTypeScroll(0), [table?.schema, table?.name, columnFilter, view]);

  const showPage = (
    rows: Record<string, unknown>[],
    offset: number,
    label: string,
    before = false,
    keyset = false,
  ) => {
    const records =
      before && rows.length > pageSize ? rows.slice(-pageSize) : rows.slice(0, pageSize);
    setPage({
      records,
      offset,
      hasMore: (before && records.length > 0) || rows.length > pageSize,
      keyset,
    });
    setCursor(0);
    setSearchLabel(label);
    setView("rows");
  };

  const loadPage = async (offset: number, cursor?: unknown[], before = false, order = orderBy) => {
    if (!table) {
      return;
    }

    const request = ++pageRequest.current;

    try {
      const keys =
        primaryKeyNames !== null
          ? primaryKeyNames
          : await loadPrimaryKeyNames(table.schema, table.name);
      const pageOrder = order.length ? order : makeOrder(keys);
      const rows = await listRows(
        pool,
        table.name,
        table.schema,
        pageSize + 1,
        offset,
        pageOrder.length ? { orderBy: pageOrder, cursor, before } : undefined,
      );

      if (pageRequest.current === request) {
        if (primaryKeyNames === null) setPrimaryKeyNames(keys);
        showPage(rows, offset, "", before, pageOrder.length > 0);
      }
    } catch (e) {
      if (pageRequest.current === request) setError(explainError(e));
    }
  };

  const runSearch = async (
    text: string,
    offset = 0,
    cursor?: unknown[],
    before = false,
    order = orderBy,
  ) => {
    const request = ++pageRequest.current;
    const knownColumns = columns.length ? columns.map((column) => column.name) : undefined;
    const parsed = parseSearch(text, knownColumns ?? []);

    if (!table || "error" in parsed) {
      setError("error" in parsed ? parsed.error : "");
      return;
    }

    try {
      const keys =
        primaryKeyNames !== null
          ? primaryKeyNames
          : await loadPrimaryKeyNames(table.schema, table.name);
      const pageOrder = order.length ? order : makeOrder(keys);
      const rows = await searchRecords(
        pool,
        table.name,
        parsed.filter,
        pageSize + 1,
        table.schema,
        offset,
        pageOrder.length ? { orderBy: pageOrder, cursor, before } : undefined,
        knownColumns,
      );

      if (pageRequest.current === request) {
        if (primaryKeyNames === null) setPrimaryKeyNames(keys);
        showPage(rows, offset, text.trim(), before, pageOrder.length > 0);
      }
    } catch (e) {
      if (pageRequest.current === request) setError(explainError(e));
    }
  };

  // Next and previous page of whatever is on screen: the search results, or the plain table.
  const goToPage = (offset: number, cursor?: unknown[], before = false) =>
    searchLabel ? runSearch(searchLabel, offset, cursor, before) : loadPage(offset, cursor, before);

  const nextPage = () => {
    const last = fetched.at(-1);
    void goToPage(
      (page?.offset ?? 0) + fetched.length,
      orderBy.length && last ? cursorFor(last) : undefined,
    );
  };

  const previousPage = () => {
    const first = fetched[0];
    void goToPage(
      Math.max(0, (page?.offset ?? 0) - pageSize),
      orderBy.length && first ? cursorFor(first) : undefined,
      !!(orderBy.length && first),
    );
  };

  const openRows = () => {
    setFocus("data");

    if (!page) {
      void loadPage(0);
    }
  };

  const mutateSelectedRow = async (mutation: Mutation) => {
    if (!table || !fullRecord) return;
    if (accessLevel !== "readwrite") {
      setError("This profile is read-only. Enable writes in its settings to edit rows.");
      return;
    }
    if (primaryKeys.length === 0) {
      setError("Editing requires a primary key so the selected row can be identified safely.");
      return;
    }

    try {
      const result = await mutateRecords(pool, {
        schema: table.schema,
        table: table.name,
        filters: primaryKeys.map(({ name }) => ({
          column: name,
          value: fullRecord[name] == null ? null : cellText(fullRecord[name]),
        })),
        mutation,
        limit: 1,
        allowAll: true,
        source,
        confirm: async (preview) =>
          new Promise((resolve) => {
            resolveConfirmation.current = resolve;
            const changes = preview.changes
              ?.map(({ column, value }) => `${column}=${value ?? "NULL"}`)
              .join(", ");
            const target = preview.filters
              .map(({ column, value }) => `${column}=${value ?? "NULL"}`)
              .join(", ");
            setConfirmation(
              `${mutation.operation === "delete" ? "Delete" : `Set ${changes} on`} ${table.schema}.${table.name} (${target})? y/N`,
            );
          }),
      });

      if (result.applied) void goToPage(0);
    } catch (e) {
      setError(explainError(e));
    }
  };

  const fields = {
    tables: [tableFilter, setTableFilter],
    columns: [columnFilter, setColumnFilter],
    search: [searchText, setSearchText],
  } as const;

  useInput((input, key) => {
    setError("");

    if (confirmation) {
      if (input.toLowerCase() === "y") {
        setConfirmation(null);
        resolveConfirmation.current?.(true);
        resolveConfirmation.current = null;
      } else if (input.toLowerCase() === "n" || key.escape || key.return) {
        setConfirmation(null);
        resolveConfirmation.current?.(false);
        resolveConfirmation.current = null;
      }

      return;
    }

    if (helpOpen) {
      if (key.escape || input === "?") setHelpOpen(false);
      return;
    }

    if (sortPicker) {
      if (key.escape) {
        setSortPicker(null);
      } else if (key.upArrow || key.downArrow) {
        setSortPicker({
          ...sortPicker,
          selected: clamp(
            sortPicker.selected + (key.downArrow ? 1 : -1),
            0,
            sortableColumns.length - 1,
          ),
          scroll: clamp(
            sortPicker.selected + (key.downArrow ? 1 : -1) - (detailRoom - 3),
            0,
            Math.max(0, sortableColumns.length - detailRoom + 2),
          ),
        });
      } else if (key.leftArrow || key.rightArrow) {
        setSortPicker({
          ...sortPicker,
          direction: sortPicker.direction === "ASC" ? "DESC" : "ASC",
        });
      } else if (
        key.return &&
        sortableColumns[sortPicker.selected] &&
        validPrimaryKeyNames.length
      ) {
        const nextSort: SortColumn = {
          column: sortableColumns[sortPicker.selected]!.name,
          direction: sortPicker.direction,
        };
        const nextOrder = [
          nextSort,
          ...validPrimaryKeyNames
            .filter((name) => name !== nextSort.column)
            .map((column) => ({ column, direction: "ASC" as const })),
        ];
        const label = searchLabel;
        setSortOrder(nextSort);
        setSortPicker(null);
        if (label) void runSearch(label, 0, undefined, false, nextOrder);
        else void loadPage(0, undefined, false, nextOrder);
      }

      return;
    }

    if (rowEditor) {
      if (rowEditor.stage === "field") {
        if (key.escape) {
          setRowEditor(null);
        } else if (key.downArrow || key.upArrow) {
          const selected = clamp(
            rowEditor.selected + (key.downArrow ? 1 : -1),
            0,
            columns.length - 1,
          );
          setRowEditor({
            ...rowEditor,
            selected,
            scroll: clamp(
              selected - (detailRoom - 2),
              0,
              Math.max(0, columns.length - detailRoom + 1),
            ),
          });
        } else if (key.return && columns[rowEditor.selected]) {
          const column = columns[rowEditor.selected];
          if (!column) return;
          const value = fullRecord?.[column.name];
          setRowEditor({
            ...rowEditor,
            stage: "value",
            value: value == null ? "" : cellText(value),
          });
        }
      } else if (key.escape) {
        setRowEditor({ ...rowEditor, stage: "field" });
      } else if (key.return) {
        const column = columns[rowEditor.selected];
        if (column) {
          setRowEditor(null);
          void mutateSelectedRow({
            operation: "update",
            changes: [{ column: column.name, value: parseMutationValue(rowEditor.value) }],
          });
        }
      } else if (key.backspace || key.delete) {
        setRowEditor({ ...rowEditor, value: rowEditor.value.slice(0, -1) });
      } else if (input && !key.ctrl && !key.meta) {
        setRowEditor({ ...rowEditor, value: rowEditor.value + input });
      }

      return;
    }

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
    } else if (input === "?") {
      setHelpOpen(true);
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
    } else if (focus === "data" && (view === "rows" || zoom) && input === "e" && record) {
      if (!canMutate) {
        setError("Editing requires a writable profile and a primary key.");
      } else {
        setRowEditor({ stage: "field", selected: 0, value: "", scroll: 0 });
      }
    } else if (focus === "data" && (view === "rows" || zoom) && input === "x" && record) {
      void mutateSelectedRow({ operation: "delete" });
    } else if (focus === "data" && view === "rows" && input === "S") {
      if (!validPrimaryKeyNames.length) {
        setError("Sorting needs a primary key for stable paging.");
      } else if (!sortableColumns.length) {
        setError("This table has no sortable columns.");
      } else {
        const selectedSort = sortableColumns.findIndex(
          (column) => column.name === sortOrder?.column,
        );
        setSortPicker({
          selected: Math.max(0, selectedSort),
          direction: sortOrder?.direction ?? "ASC",
          scroll: Math.max(0, selectedSort - (detailRoom - 3)),
        });
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
      nextPage();
    } else if ((input === "p" || key.pageUp) && page && page.offset > 0) {
      previousPage();
    }
  });

  const { start, end } = visibleWindow(visibleTables.length, selected, tablesHeight - 2);
  const rowSelectionColor =
    focus === "data" ? theme.selectedBackground : theme.idleSelectedBackground;
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
          fetched.length
            ? page?.keyset
              ? `page ${Math.floor(offset / pageSize) + 1} · ${fetched.length} rows`
              : `rows ${offset + 1}–${offset + fetched.length}${hasMore ? "+" : ""}`
            : "",
          searchLabel ? `find ${searchLabel}` : "",
          columnFilter ? `columns "${columnFilter}"` : "",
          grid && grid.total > 1
            ? `cols ${grid.first + 1}–${grid.first + grid.shown}/${grid.total}`
            : "",
          validPrimaryKeyNames.length
            ? `sort ${sortOrder?.column ?? validPrimaryKeyNames.join(", ")} ${sortOrder?.direction ?? "ASC"}`
            : "offset pages · no primary key",
        ]
          .filter(Boolean)
          .join(" · ");

  const detailRows = zoom
    ? entries.slice(detailScroll, detailScroll + detailRoom)
    : entries.slice(0, detailRoom);
  const editingColumn = rowEditor ? columns[rowEditor.selected] : undefined;
  const detailTitle = rowEditor
    ? rowEditor.stage === "field"
      ? "Edit row · choose a field"
      : `Edit ${editingColumn?.name ?? "field"}`
    : sortPicker
      ? `Sort · ${sortPicker.direction}`
      : !record
        ? "[4] Row"
        : [
            page?.keyset
              ? `[4] Row ${cursor + 1} on page ${Math.floor(offset / pageSize) + 1}`
              : `[4] Row ${offset + cursor + 1}`,
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
      ? [
          ["↑↓", "move"],
          ["enter", "rows"],
          ["/", "search tables"],
          ["f", "find rows"],
          ["s", "profiles"],
          ["q", "quit"],
        ]
      : sortPicker
        ? [
            ["↑↓", "choose column"],
            ["←→", "direction"],
            ["enter", "apply"],
            ["esc", "cancel"],
          ]
        : rowEditor
          ? rowEditor.stage === "field"
            ? [
                ["↑↓", "choose field"],
                ["enter", "edit value"],
                ["esc", "cancel"],
              ]
            : [
                ["enter", "review change"],
                ["esc", "back"],
                ["q", "quit"],
              ]
          : zoom
            ? [
                ["↑↓", "scroll"],
                ["←→", "other row"],
                ["esc", "back"],
                ["q", "quit"],
              ]
            : view === "columns"
              ? [
                  ["↑↓", "scroll"],
                  ["/", "filter"],
                  ["c", "rows"],
                  ["esc", "back"],
                  ["q", "quit"],
                ]
              : [
                  ["↑↓", "row"],
                  ["←→", "scroll"],
                  ["enter", "zoom"],
                  ["n/p", "page"],
                  ["S", "sort"],
                  ["f", "find rows"],
                  ["/", "columns"],
                  ["c", "types"],
                  ["esc", "back"],
                  ["q", "quit"],
                ];

  if (canMutate && focus === "data" && (view === "rows" || zoom)) {
    hints.splice(zoom ? 2 : 3, 0, ["e", "edit row"], ["x", "delete row"]);
  }
  hints.unshift(["?", "help"]);

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
              <Text color={accessLevel === "readwrite" ? "green" : "yellow"} bold>
                {accessLevel === "readwrite" ? "READ / WRITE" : "READ ONLY"}
              </Text>
              <Text dimColor>{source ? ` · ${source}` : ""}</Text>
            </Text>
          </Panel>

          <Panel
            title={`[2] Tables ${tableFilter ? `${visibleTables.length}/${tables.length} /${tableFilter}` : tables.length}`}
            width={leftWidth}
            height={tablesHeight}
            focused={focus === "tables"}
          >
            {visibleTables.length === 0 && (
              <Text dimColor>{tablesLoaded ? "No tables found." : "Loading tables…"}</Text>
            )}
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
            <Panel
              title={rowsTitle}
              width={rightWidth}
              height={rowsHeight}
              focused={focus === "data"}
            >
              {(view === "columns" || focus === "tables") &&
                typeRows.map((c) => (
                  <Text key={c.name} wrap="truncate-end">
                    <Text bold>{c.name.padEnd(nameWidth)}</Text>
                    <Text color={theme.accent}>{c.dataType.padEnd(typeWidth)}</Text>
                    <Text dimColor>{c.nullable ? "null" : "not null"}</Text>
                    {c.defaultValue ? <Text dimColor>{`  = ${c.defaultValue}`}</Text> : null}
                  </Text>
                ))}
              {(view === "columns" || focus === "tables") &&
                columnFilter &&
                typeList.length === 0 && <Text dimColor>No column matches "{columnFilter}".</Text>}

              {focus === "data" && view === "rows" && !page && <Text dimColor>Loading rows…</Text>}
              {focus === "data" && view === "rows" && page && fetched.length === 0 && (
                <Text dimColor>
                  {searchLabel ? "No matching records found." : "This table is empty."}
                </Text>
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
                      <Text
                        key={i}
                        wrap="truncate-end"
                        backgroundColor={rowSelectionColor}
                        color={theme.selectedText}
                      >
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

          <Panel
            title={helpOpen ? "Keyboard shortcuts" : detailTitle}
            width={rightWidth}
            height={detailHeight}
            focused={zoom}
          >
            {helpOpen ? (
              <>
                <Text bold color={theme.accent}>
                  Navigation
                </Text>
                <Text>↑ / ↓ Move through tables, rows, or details</Text>
                <Text>Enter Open rows or expand the selected row</Text>
                <Text>Tab Switch between tables and rows</Text>
                <Text>Esc Go back, clear a filter, or leave a search</Text>
                <Text>n / p Next / previous page</Text>
                <Text>h / l Scroll columns left / right</Text>
                <Text>f Search rows</Text>
                <Text>S Sort rows by a column (primary key required)</Text>
                <Text>/ Filter tables or columns</Text>
                <Text>c Show / hide column types</Text>
                {accessLevel === "readwrite" && (
                  <>
                    <Text>e / x Edit / delete the selected row (table needs a primary key)</Text>
                    <Text>y Confirm a write; n or Esc cancels it</Text>
                  </>
                )}
                <Text>? Close this guide</Text>
                <Text dimColor>Press Esc or ? to return to the browser.</Text>
              </>
            ) : sortPicker ? (
              <>
                <Text dimColor>
                  Choose a sort column. Primary keys break ties for stable paging.
                </Text>
                <Text dimColor>Direction: {sortPicker.direction} · ← / → to change</Text>
                {sortableColumns
                  .slice(sortPicker.scroll, sortPicker.scroll + detailRoom - 2)
                  .map((column, visibleIndex) => {
                    const index = visibleIndex + sortPicker.scroll;
                    const selectedSort = index === sortPicker.selected;
                    return (
                      <Text
                        key={column.name}
                        wrap="truncate-end"
                        backgroundColor={selectedSort ? rowSelectionColor : undefined}
                        color={selectedSort ? theme.selectedText : undefined}
                      >
                        {column.name} {column.dataType}
                      </Text>
                    );
                  })}
              </>
            ) : rowEditor ? (
              rowEditor.stage === "field" ? (
                <>
                  <Text dimColor>Select a field, then enter its replacement value.</Text>
                  {columns
                    .slice(rowEditor.scroll, rowEditor.scroll + detailRoom - 1)
                    .map((column, visibleIndex) => {
                      const index = visibleIndex + rowEditor.scroll;
                      const isSelected = index === rowEditor.selected;
                      return (
                        <Text
                          key={column.name}
                          wrap="truncate-end"
                          backgroundColor={isSelected ? rowSelectionColor : undefined}
                          color={isSelected ? theme.selectedText : undefined}
                        >
                          {column.name}:{" "}
                          {fullRecord?.[column.name] == null
                            ? "NULL"
                            : cellText(fullRecord[column.name])}
                        </Text>
                      );
                    })}
                </>
              ) : (
                <>
                  <Text dimColor wrap="truncate-end">
                    Current:{" "}
                    {fullRecord?.[editingColumn?.name ?? ""] == null
                      ? "NULL"
                      : cellText(fullRecord?.[editingColumn?.name ?? ""])}
                  </Text>
                  <Text>Type a new value. NULL clears it; \\NULL writes the text NULL.</Text>
                  <Text color={theme.accent} wrap="truncate-end">
                    {rowEditor.value}▏
                  </Text>
                  <Text dimColor>Enter continues to the existing write confirmation.</Text>
                </>
              )
            ) : (
              <>
                {!record && (
                  <Text dimColor>
                    {focus === "tables"
                      ? "Select a table, then press Enter to browse its rows."
                      : ""}
                  </Text>
                )}
                {detailRows.map((entry, i) => (
                  <Text key={i} wrap={zoom ? "wrap" : "truncate-end"}>
                    <Text color={theme.accent}>{entry.key}</Text>
                    {"  "}
                    <Text color={entry.kind === "text" ? undefined : theme[entry.kind]}>
                      {entry.value}
                    </Text>
                  </Text>
                ))}
              </>
            )}
          </Panel>
        </Box>
      </Box>

      <StatusBar
        hints={hints}
        error={error}
        prompt={
          confirmation ??
          (rowEditor?.stage === "value"
            ? "New value"
            : typing
              ? `${PROMPTS[typing]}: ${fields[typing][0]}`
              : undefined)
        }
      />
    </Box>
  );
}
