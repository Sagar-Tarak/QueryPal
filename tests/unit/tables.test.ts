import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { listTables } from "../../src/database/postgres/tables.js";

describe("listTables", () => {
  it("should map rows and list every schema by default", async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ table_schema: "sales", table_name: "orders" }],
      }),
    } as unknown as Pool;

    const tables = await listTables(pool);

    expect(tables).toEqual([{ schema: "sales", name: "orders" }]);
    expect(pool.query).toHaveBeenCalledWith(expect.any(String), [null]);
  });

  it("should filter by schema when given", async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    } as unknown as Pool;

    await listTables(pool, "sales");

    expect(pool.query).toHaveBeenCalledWith(expect.any(String), ["sales"]);
  });
});
