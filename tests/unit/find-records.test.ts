

import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { findRecords } from "../../src/database/postgres/find-records.js";

describe("findRecords", () => {
  it("should return matching records", async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{ column_name: "id" }],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 1, name: "Alice" }],
        }),
    } as unknown as Pool;

    const records = await findRecords(pool, "users", {
      column: "id",
      value: "1",
    });

    expect(records).toEqual([{ id: 1, name: "Alice" }]);
    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  it("should reject a column that does not exist", async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ column_name: "id" }],
      }),
    } as unknown as Pool;

    await expect(
      findRecords(pool, "users", {
        column: "password",
        value: "anything",
      }),
    ).rejects.toThrow('Column "password" was not found.');

    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it("should pass the filter value as a query parameter", async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{ column_name: "name" }],
        })
        .mockResolvedValueOnce({
          rows: [],
        }),
    } as unknown as Pool;

    await findRecords(pool, "users", {
      column: "name",
      value: "' OR 1=1 --",
    });

    const queryCalls = vi.mocked(pool.query).mock.calls;

    expect(queryCalls[1]?.[0]).toContain("= $1");
    expect(queryCalls[1]?.[1]).toEqual(["' OR 1=1 --"]);
  });
});
