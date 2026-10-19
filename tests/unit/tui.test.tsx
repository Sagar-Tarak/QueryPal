import { render } from "ink-testing-library";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { formatDetail, formatRows, formatTable, visibleWindow } from "../../src/tui/format.js";
import { App } from "../../src/tui/app.js";

const wait = () => new Promise((resolve) => setTimeout(resolve, 60));
const ROWS = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, name: `user${i + 1}` }));

// Answers by SQL text: connection info, table list, column list, one page of rows, or a search.
const fakePool = (
  rows: Record<string, unknown>[] = ROWS,
  describedColumns = 2,
  primaryKeys: string[] = [],
) =>
  ({
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes("current_database")) {
        return { rows: [{ database: "shop", user: "me", version: "17.1" }] };
      }

      if (sql.includes("table_schema, table_name, column_name")) {
        return {
          rows: [
            { table_schema: "public", table_name: "users", column_name: "id" },
            { table_schema: "public", table_name: "users", column_name: "name" },
            { table_schema: "public", table_name: "orders", column_name: "id" },
            { table_schema: "public", table_name: "orders", column_name: "total_amount" },
          ],
        };
      }

      if (sql.includes("information_schema.tables")) {
        return {
          rows: [
            { table_schema: "public", table_name: "users" },
            { table_schema: "public", table_name: "orders" },
          ],
        };
      }

      if (sql.includes("is_nullable")) {
        return {
          rows:
            describedColumns === 2
              ? [
                  {
                    column_name: "id",
                    data_type: "integer",
                    is_nullable: "NO",
                    column_default: null,
                  },
                  {
                    column_name: "name",
                    data_type: "text",
                    is_nullable: "YES",
                    column_default: null,
                  },
                ]
              : Array.from({ length: describedColumns }, (_, i) => ({
                  column_name: `col_${i}`,
                  data_type: "text",
                  is_nullable: "YES",
                  column_default: i % 2 ? "'x'::text" : null,
                })),
        };
      }

      if (sql.includes("information_schema.table_constraints")) {
        return { rows: primaryKeys.map((column_name) => ({ column_name })) };
      }

      if (sql.includes("information_schema.columns")) {
        return { rows: [{ column_name: "id" }, { column_name: "name" }] };
      }

      // This fixture has no primary key, so browsing and searching use LIMIT/OFFSET.
      const limit = Number(/LIMIT (\d+)/.exec(sql)?.[1]);
      const offset = Number(/OFFSET (\d+)/.exec(sql)?.[1] ?? 0);

      if (sql.includes('"id" > $1')) {
        return { rows: rows.filter((row) => Number(row.id) > Number(params?.[0])).slice(0, limit) };
      }

      return { rows: rows.slice(offset, offset + limit) };
    }),
  }) as unknown as Pool;

// Renders the app and waits for the table list to load, so the first key press has a table.
const open = async (rows?: Record<string, unknown>[]) => {
  const app = render(<App pool={fakePool(rows)} />);

  await wait();

  return app;
};

const press = async (stdin: { write: (s: string) => void }, ...keys: string[]) => {
  for (const key of keys) {
    stdin.write(key);
    await wait();
  }
};

describe("formatRows", () => {
  it("should return nothing for no records", () => {
    expect(formatRows([], 80)).toEqual([]);
  });

  it("should fit every line inside the width and mark NULL and dates", () => {
    const lines = formatRows([{ id: 1, note: null, at: new Date("2026-10-17T10:50:35.179Z") }], 40);

    expect(lines).toHaveLength(2);
    expect(lines.every((line) => line.length <= 40)).toBe(true);
    expect(lines[1]).toContain("NULL");
    expect(lines[1]).toContain("2026-10-17");
    expect(lines[1]).not.toContain('"');
  });
});

describe("wide tables", () => {
  const wide = [Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`column_${i}`, i]))];

  it("should show only the columns that fit, never wider than the pane", () => {
    const grid = formatTable(wide, 60);

    expect(grid).toMatchObject({ first: 0, total: 15 });
    expect(grid!.shown).toBeLessThan(15);
    expect(grid!.shown).toBeGreaterThan(3);
    expect(formatRows(wide, 60).every((line) => line.length <= 60)).toBe(true);
  });

  it("should scroll sideways from a given column", () => {
    const grid = formatTable(wide, 60, 5);

    expect(grid!.first).toBe(5);
    expect(grid!.header[0]?.trim()).toBe("column_5");
  });

  it("should always show at least one column, and clamp the start", () => {
    expect(formatTable(wide, 3)!.shown).toBe(1);
    expect(formatTable(wide, 60, 99)!.first).toBe(14);
  });
});

describe("column sizing", () => {
  const records = [
    {
      id: "02a3a1ae-0b6c-4d52-9f2e-7a1c3d4e5f60",
      name: "TEJAS ENTERPRISES PVT LTD",
      n: 7,
      flag: false,
    },
  ];

  it("should give long values room instead of cutting them at 10 characters", () => {
    const [, line] = formatRows(records, 100);

    expect(line).toContain("TEJAS ENTERPRISES PVT LTD");
    expect(line).toContain("02a3a1ae-0b6c-4d52-9f2e-7a");
  });

  it("should cap very wide values with an ellipsis", () => {
    const [, line] = formatRows([{ note: "x".repeat(200) }], 100);

    expect(line).toContain("…");
    expect(line!.length).toBeLessThanOrEqual(100);
  });

  it("should right-align numbers and tag cell kinds", () => {
    const grid = formatTable([{ amount: 7, other_column: 12345 }], 60)!;

    expect(grid.rows[0]![0]!.text).toBe("amount".replace(/./g, " ").slice(1) + "7");
    expect(grid.rows[0]!.map((c) => c.kind)).toEqual(["number", "number"]);
  });

  it("should give spare width back to columns that were cut", () => {
    const grid = formatTable([{ a: "y".repeat(40), b: "z".repeat(40) }], 100)!;

    expect(grid.rows[0]![0]!.text.length + 1 + grid.rows[0]![1]!.text.length).toBeLessThanOrEqual(
      100,
    );
    expect(grid.rows[0]![0]!.text.length).toBeGreaterThan(28);
  });
});

describe("formatDetail", () => {
  it("should show every column with its full value and kind", () => {
    const long = "x".repeat(200);

    expect(formatDetail({ id: 1, notes: long, gone: null })).toEqual([
      { key: "id   ", value: "1", kind: "number" },
      { key: "notes", value: long, kind: "text" },
      { key: "gone ", value: "NULL", kind: "null" },
    ]);
  });

  it("should cap very long column names", () => {
    const [entry] = formatDetail({ [`c${"o".repeat(60)}`]: 1 });

    expect(entry!.key.length).toBe(28);
    expect(entry!.key.endsWith("…")).toBe(true);
  });
});

describe("visibleWindow", () => {
  it("should keep the selected item inside the window", () => {
    expect(visibleWindow(5, 2, 15)).toEqual({ start: 0, end: 5 });
    expect(visibleWindow(100, 50, 15)).toEqual({ start: 43, end: 58 });
    expect(visibleWindow(100, 99, 15)).toEqual({ start: 85, end: 100 });
  });
});

describe("App", () => {
  it("labels keyset pages by page number instead of claiming absolute row positions", async () => {
    const { lastFrame, stdin } = render(<App pool={fakePool(ROWS, 2, ["id"])} />);

    await wait();
    await press(stdin, "\r");
    expect(lastFrame()).toContain("page 1 · 12 rows");

    await press(stdin, "n");
    expect(lastFrame()).toContain("page 2 · 8 rows");
    expect(lastFrame()).not.toContain("rows 13–20");
    expect(lastFrame()).toContain("Row 1 on page 2");
  });

  it("should show the connection in the header, the tables, and the columns", async () => {
    const { lastFrame } = render(<App pool={fakePool()} />);

    await wait();

    expect(lastFrame()).toContain("[1] Connection");
    expect(lastFrame()).toContain("me · PostgreSQL 17.1");
    expect(lastFrame()).toContain("[2] Tables 2");
    expect(lastFrame()).toContain("orders");
    expect(lastFrame()).not.toContain("public.orders");
    expect(lastFrame()).toContain("not null");
  });

  it("should open rows with Enter and page forward and back", async () => {
    const { lastFrame, stdin } = await open();

    await press(stdin, "\r");
    expect(lastFrame()).toContain("rows 1–12+");
    expect(lastFrame()).toContain("user1 ");

    await press(stdin, "n");
    expect(lastFrame()).toContain("rows 13–20");
    expect(lastFrame()).toContain("user20");

    await press(stdin, "n");
    expect(lastFrame()).toContain("rows 13–20");

    await press(stdin, "p");
    expect(lastFrame()).toContain("rows 1–12+");
  });

  it("should preview the selected row beside the rows, following the cursor", async () => {
    const { lastFrame, stdin } = await open();

    await press(stdin, "\r");
    expect(lastFrame()).toContain("[4] Row 1");
    expect(lastFrame()).toContain("name  user1");

    await press(stdin, "\u001B[B");
    expect(lastFrame()).toContain("[4] Row 2");
    expect(lastFrame()).toContain("name  user2");
  });

  it("should zoom the row with Enter and go back with Esc", async () => {
    const { lastFrame, stdin } = await open();

    await press(stdin, "\r", "\u001B[B", "\r");
    expect(lastFrame()).toContain("name  user2");
    expect(lastFrame()).not.toContain("[3]");

    await press(stdin, "\u001B");
    expect(lastFrame()).toContain("[3] public.users");
    expect(lastFrame()).toContain("rows 1–12+");
  });

  describe("the column types list of a table with many columns", () => {
    const open40 = async () => {
      const app = render(<App pool={fakePool(ROWS, 40)} />);

      await wait();

      return app;
    };

    it("should show only the rows that fit, so lines never overlap", async () => {
      const { lastFrame } = await open40();
      const frame = lastFrame() ?? "";

      expect(frame).toMatch(/column types \d+ of 40/);
      expect(frame).toContain("col_0");
      expect(frame).not.toContain("col_39");
      expect(frame).not.toMatch(/nullnull|nullnot/);
    });

    it("should scroll the whole list in the types view", async () => {
      const { lastFrame, stdin } = await open40();

      await press(stdin, "\r", "c");
      expect(lastFrame()).toMatch(/column types 1–\d+\/40/);
      expect(lastFrame()).not.toContain("col_39");

      for (let i = 0; i < 45; i++) {
        stdin.write("\u001B[B");
      }

      await wait();
      expect(lastFrame()).toContain("col_39");
      expect(lastFrame()).toMatch(/column types \d+–40\/40/);
    });

    it("should filter the list by column name", async () => {
      const { lastFrame, stdin } = await open40();

      await press(stdin, "\r", "c", "/", "3", "9", "\r");

      expect(lastFrame()).toContain("col_39");
      expect(lastFrame()).not.toContain("col_0");
    });
  });

  describe("a table with many columns", () => {
    const WIDE = [
      Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`column_${i}`, `value_${i}`])),
    ];

    it("should scroll the columns sideways with the arrow keys", async () => {
      const { lastFrame, stdin } = await open(WIDE);

      await press(stdin, "\r");
      expect(lastFrame()).toContain("cols 1–");
      expect(lastFrame()).toContain("/40");

      await press(stdin, "\u001B[C", "\u001B[C");
      expect(lastFrame()).toContain("cols 3–");

      await press(stdin, "\u001B[D");
      expect(lastFrame()).toContain("cols 2–");
    });

    it("should scroll a zoomed row and read every column", async () => {
      const { lastFrame, stdin } = await open(WIDE);

      await press(stdin, "\r", "\r");
      expect(lastFrame()).toContain("column_0");
      expect(lastFrame()).not.toContain("column_39");
      expect(lastFrame()).toContain("columns 1–");

      for (let i = 0; i < 40; i++) {
        stdin.write("\u001B[B");
      }

      await wait();
      expect(lastFrame()).toContain("column_39");
      expect(lastFrame()).toContain("value_39");
    });
  });

  it("should zoom a row far down the page, not only the first few", async () => {
    const { lastFrame, stdin } = await open();

    await press(
      stdin,
      "\r",
      "\u001B[B",
      "\u001B[B",
      "\u001B[B",
      "\u001B[B",
      "\u001B[B",
      "\u001B[B",
      "\r",
    );

    expect(lastFrame()).toContain("[4] Row 7");
    expect(lastFrame()).toContain("name  user7");

    await press(stdin, "\u001B[C");
    expect(lastFrame()).toContain("[4] Row 8");

    await press(stdin, "\u001B");
    expect(lastFrame()).toContain("rows 1–12+");
  });

  it("should narrow the table list with /", async () => {
    const { lastFrame, stdin } = await open();

    await press(stdin, "/", "o", "r", "d", "\r");

    expect(lastFrame()).toContain("[2] Tables 1/2 /ord");
    expect(lastFrame()).toContain("public.orders");
    expect(lastFrame()).not.toContain("public.users");
  });

  describe("search", () => {
    const type = (text: string) => [...text];
    const sqlOf = (pool: Pool) => vi.mocked(pool.query).mock.calls.map(([sql]) => String(sql));

    it("should find rows by exact column value", async () => {
      const pool = fakePool();
      const { lastFrame, stdin } = render(<App pool={pool} />);

      await wait();
      await press(stdin, "f", ...type("id=1"), "\r");

      expect(lastFrame()).toContain("find id=1");
      expect(lastFrame()).toContain("user1 ");
      expect(sqlOf(pool).some((sql) => sql.includes('"id" = $1'))).toBe(true);
    });

    it("should find rows by text in any column", async () => {
      const pool = fakePool();
      const { lastFrame, stdin } = render(<App pool={pool} />);

      await wait();
      await press(stdin, "f", ...type("user"), "\r");

      expect(lastFrame()).toContain("find user");
      expect(
        sqlOf(pool).some((sql) => sql.includes('"id"::text ILIKE $1 OR "name"::text ILIKE $1')),
      ).toBe(true);
    });

    it("should find rows by text in one column", async () => {
      const pool = fakePool();
      const { stdin } = render(<App pool={pool} />);

      await wait();
      await press(stdin, "f", ...type("name~ali"), "\r");

      expect(sqlOf(pool).some((sql) => sql.includes('WHERE "name"::text ILIKE $1'))).toBe(true);
    });

    it("should page through search results and clear the search with Esc", async () => {
      const { lastFrame, stdin } = await open();

      await press(stdin, "f", ...type("user"), "\r");
      expect(lastFrame()).toContain("rows 1–12+");

      await press(stdin, "n");
      expect(lastFrame()).toContain("find user");
      expect(lastFrame()).toContain("rows 13–20");
      expect(lastFrame()).toContain("user20");

      await press(stdin, "\u001B");
      expect(lastFrame()).not.toContain("find user");
      expect(lastFrame()).toContain("rows 1–12+");
    });

    it("should refuse an empty search", async () => {
      const { lastFrame, stdin } = await open();

      await press(stdin, "f", "\r");

      expect(lastFrame()).toContain("Type something to search.");
    });

    it("should filter the shown columns with / and bring them back with Esc", async () => {
      const { lastFrame, stdin } = await open();

      await press(stdin, "\r");
      expect(lastFrame()).toMatch(/\bid\b/);

      await press(stdin, "/", ...type("na"), "\r");
      expect(lastFrame()).toContain('columns "na"');
      expect(lastFrame()).toContain("name  user1");
      expect(lastFrame()).not.toMatch(/\bid\b/);

      await press(stdin, "\u001B");
      expect(lastFrame()).not.toContain('columns "na"');
      expect(lastFrame()).toMatch(/\bid\b/);
    });

    it("should say so when no column matches the filter", async () => {
      const { lastFrame, stdin } = await open();

      await press(stdin, "\r", "/", ...type("zzz"), "\r");

      expect(lastFrame()).toContain('No column matches "zzz"');
    });

    it("should find tables by a column name with @", async () => {
      const { lastFrame, stdin } = await open();

      await press(stdin, "/", ...type("@total"), "\r");

      expect(lastFrame()).toContain("[2] Tables 1/2 /@total");
      expect(lastFrame()).toContain("orders");
      expect(lastFrame()).not.toContain("users");
    });
  });
});
