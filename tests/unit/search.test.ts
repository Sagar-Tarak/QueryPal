import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { listColumnIndex } from "../../src/database/postgres/column-index.js";
import { searchRecords } from "../../src/database/postgres/search-records.js";
import { columnMatches, matchTables, parseSearch } from "../../src/tui/search.js";

describe("parseSearch", () => {
  const cols = ["id", "account_name"];

  it("should treat plain text as a search in every column", () => {
    expect(parseSearch("  Cash ", cols)).toEqual({ filter: { text: "Cash" } });
  });

  it("should read column~text and column=value when the column exists", () => {
    expect(parseSearch("account_name~Cash", cols)).toEqual({
      filter: { column: "account_name", op: "~", value: "Cash" },
    });
    expect(parseSearch("id=7", cols)).toEqual({ filter: { column: "id", op: "=", value: "7" } });
  });

  it("should keep later = or ~ inside the value", () => {
    expect(parseSearch("id=a=b", cols)).toEqual({ filter: { column: "id", op: "=", value: "a=b" } });
  });

  it("should fall back to text when the part before = is not a column", () => {
    expect(parseSearch("a=b", cols)).toEqual({ filter: { text: "a=b" } });
    expect(parseSearch("=x", cols)).toEqual({ filter: { text: "=x" } });
  });

  it("should reject an empty search", () => {
    expect(parseSearch("   ", cols)).toEqual({ error: "Type something to search." });
  });
});

describe("matchTables", () => {
  const tables = [
    { schema: "public", name: "LeaveRequestApprovals" },
    { schema: "public", name: "accounts" },
    { schema: "sales", name: "orders" },
  ];
  const index = {
    "public.LeaveRequestApprovals": ["id", "leaveRequestId"],
    "public.accounts": ["id", "gst_number"],
    "sales.orders": ["id", "GSTIN"],
  };
  const names = (query: string) => matchTables(tables, index, query).map((t) => t.name);

  it("should return every table for an empty query", () => {
    expect(names("  ")).toHaveLength(3);
  });

  it("should match names ignoring case, schema included", () => {
    expect(names("ACCOUNT")).toEqual(["accounts"]);
    expect(names("sales.")).toEqual(["orders"]);
  });

  it("should require every word to match", () => {
    expect(names("leave appr")).toEqual(["LeaveRequestApprovals"]);
    expect(names("leave orders")).toEqual([]);
  });

  it("should find tables by column name with @", () => {
    expect(names("@gst")).toEqual(["accounts", "orders"]);
    expect(names("@ gst_n")).toEqual(["accounts"]);
    expect(names("@nothing")).toEqual([]);
  });

  it("should match nothing for @ when the column index is empty", () => {
    expect(matchTables(tables, {}, "@id")).toEqual([]);
  });
});

describe("columnMatches", () => {
  it("should match part of a name, ignoring case and outer spaces", () => {
    expect(columnMatches("gst_number", " GST ")).toBe(true);
    expect(columnMatches("name", "gst")).toBe(false);
    expect(columnMatches("anything", "")).toBe(true);
  });
});

const describePool = (names: string[], rows: Record<string, unknown>[] = []) =>
  ({
    query: vi.fn(async (sql: string) =>
      sql.includes("is_nullable")
        ? {
            rows: names.map((n) => ({
              column_name: n,
              data_type: "text",
              is_nullable: "YES",
              column_default: null,
            })),
          }
        : sql.includes("column_name") && !sql.includes("SELECT *")
          ? { rows: names.map((column_name) => ({ column_name })) }
          : { rows },
    ),
  }) as unknown as Pool;

const lastSelect = (pool: Pool) =>
  vi.mocked(pool.query).mock.calls.map((c) => c as [string, string[]?]).filter(([sql]) => sql.includes("SELECT *")).at(-1)!;

describe("searchRecords", () => {
  it("should search every column with one parameter", async () => {
    const pool = describePool(["id", "name"], [{ id: 1 }]);

    expect(await searchRecords(pool, "users", { text: "cash" }, 20, "public", 40)).toEqual([{ id: 1 }]);

    const [sql, params] = lastSelect(pool);

    expect(sql).toContain('"id"::text ILIKE $1 OR "name"::text ILIKE $1');
    expect(sql).toContain('FROM "public"."users"');
    expect(sql).toContain("LIMIT 20 OFFSET 40");
    expect(params).toEqual(["%cash%"]);
  });

  it("should search one column with contains", async () => {
    const pool = describePool(["id", "name"]);

    await searchRecords(pool, "users", { column: "name", op: "~", value: "al" }, 5);

    const [sql, params] = lastSelect(pool);

    expect(sql).toContain('WHERE "name"::text ILIKE $1');
    expect(sql).not.toContain('"id"');
    expect(params).toEqual(["%al%"]);
  });

  it("should search wildcards and backslashes literally", async () => {
    const pool = describePool(["name"]);

    await searchRecords(pool, "users", { text: "100%_\\" }, 5);

    expect(lastSelect(pool)[1]).toEqual(["%100\\%\\_\\\\%"]);
  });

  it("should pass an injection attempt only as a parameter", async () => {
    const pool = describePool(["name"]);

    await searchRecords(pool, "users", { text: "'; DROP TABLE users; --" }, 5);

    const [sql, params] = lastSelect(pool);

    expect(sql).not.toContain("DROP");
    expect(params).toEqual(["%'; DROP TABLE users; --%"]);
  });

  it("should hand exact matches to findRecords, keeping the offset", async () => {
    const pool = describePool(["id"], [{ id: 7 }]);

    await searchRecords(pool, "users", { column: "id", op: "=", value: "7" }, 5, "public", 10);

    const [sql, params] = lastSelect(pool);

    expect(sql).toContain('"id" = $1');
    expect(sql).toContain("LIMIT 5 OFFSET 10");
    expect(params).toEqual(["7"]);
  });

  it("should reject an unknown column, an unknown table, and bad paging", async () => {
    await expect(
      searchRecords(describePool(["id"]), "users", { column: "nope", op: "~", value: "x" }, 5),
    ).rejects.toThrow('Column "nope" was not found.');
    await expect(searchRecords(describePool([]), "ghost", { text: "x" }, 5)).rejects.toThrow(
      'Table "ghost" was not found.',
    );

    const pool = describePool(["id"]);

    await expect(searchRecords(pool, "users", { text: "x" }, 0)).rejects.toThrow("Limit");
    await expect(searchRecords(pool, "users", { text: "x" }, 5, "public", -1)).rejects.toThrow("Offset");
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe("listColumnIndex", () => {
  it("should group column names by schema.table in order", async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [
          { table_schema: "public", table_name: "a", column_name: "id" },
          { table_schema: "public", table_name: "a", column_name: "name" },
          { table_schema: "sales", table_name: "b", column_name: "id" },
        ],
      }),
    } as unknown as Pool;

    expect(await listColumnIndex(pool)).toEqual({
      "public.a": ["id", "name"],
      "sales.b": ["id"],
    });
  });
});
