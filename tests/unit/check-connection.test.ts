import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { checkConnection } from "../../src/database/postgres/check-connection.js";

describe("checkConnection", () => {
  it("should return the database, user, version and timing", async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ database: "testDB", user: "querypal", version: "16.4" }],
      }),
    } as unknown as Pool;

    const info = await checkConnection(pool);

    expect(info).toMatchObject({ database: "testDB", user: "querypal", version: "16.4" });
    expect(info.ms).toBeGreaterThanOrEqual(0);
  });

  it("should fail when the server returns nothing", async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) } as unknown as Pool;

    await expect(checkConnection(pool)).rejects.toThrow("no answer");
  });

  it("should pass connection errors through", async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error("boom")) } as unknown as Pool;

    await expect(checkConnection(pool)).rejects.toThrow("boom");
  });
});
