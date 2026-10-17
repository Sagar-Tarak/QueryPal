import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { listRows } from "../../src/database/postgres/list-rows.js";

const fakePool = () =>
  ({ query: vi.fn().mockResolvedValue({ rows: [{ id: 1 }] }) }) as unknown as Pool;

describe("listRows", () => {
  it("should read one page with quoted schema and table", async () => {
    const pool = fakePool();

    expect(await listRows(pool, "Leave Requests", "sales", 20, 40)).toEqual([{ id: 1 }]);
    expect(pool.query).toHaveBeenCalledWith(
      'SELECT * FROM "sales"."Leave Requests" LIMIT 20 OFFSET 40',
    );
  });

  it("should escape double quotes in names", async () => {
    const pool = fakePool();

    await listRows(pool, 'a"b', "public", 1, 0);

    expect(vi.mocked(pool.query).mock.calls[0]?.[0]).toContain('"a""b"');
  });

  it("should reject a bad limit or offset before querying", async () => {
    const pool = fakePool();

    await expect(listRows(pool, "t", "public", 0, 0)).rejects.toThrow("Limit");
    await expect(listRows(pool, "t", "public", 101, 0)).rejects.toThrow("Limit");
    await expect(listRows(pool, "t", "public", 10, -1)).rejects.toThrow("Offset");
    await expect(listRows(pool, "t", "public", 10, 1.5)).rejects.toThrow("Offset");
    expect(pool.query).not.toHaveBeenCalled();
  });
});
