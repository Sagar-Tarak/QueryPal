import { describe, expect, it } from "vitest";
import { createPostgresPool } from "../../src/database/postgres/client.js";

describe("PostgreSQL client", () => {
  it("should create a connection pool", async () => {
    const pool = createPostgresPool("postgresql://user:password@localhost:5432/querypal");

    expect(pool).toBeDefined();

    await pool.end();
  });

  it("should default the session to read-only and allow an explicit read-write pool", async () => {
    const readPool = createPostgresPool("postgresql://localhost/db");
    const writePool = createPostgresPool("postgresql://localhost/db", "readwrite");

    expect(readPool.options.options).toContain("default_transaction_read_only=on");
    expect(writePool.options.options).toBeUndefined();
    await Promise.all([readPool.end(), writePool.end()]);
  });
});
