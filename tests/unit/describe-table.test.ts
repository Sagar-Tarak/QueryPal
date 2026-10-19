import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { describeTable } from "../../src/database/postgres/describe-table.js";

describe("describeTable", () => {
  it("should transform PostgreSQL column metadata", async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            column_name: "id",
            data_type: "integer",
            is_nullable: "NO",
            column_default: null,
          },
          {
            column_name: "name",
            data_type: "text",
            is_nullable: "NO",
            column_default: null,
          },
        ],
      }),
    } as unknown as Pool;

    const columns = await describeTable(pool, "users");

    expect(columns).toEqual([
      {
        name: "id",
        dataType: "integer",
        nullable: false,
        defaultValue: null,
      },
      {
        name: "name",
        dataType: "text",
        nullable: false,
        defaultValue: null,
      },
    ]);

    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("information_schema.columns"), [
      "public",
      "users",
    ]);
  });

  it("should query the given schema", async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    } as unknown as Pool;

    await describeTable(pool, "orders", "sales");

    expect(pool.query).toHaveBeenCalledWith(expect.any(String), ["sales", "orders"]);
  });
});
