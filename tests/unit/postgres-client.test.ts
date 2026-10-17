import { describe, expect, it } from "vitest";
import { createPostgresPool } from "../../src/database/postgres/client.js";

describe("PostgreSQL client", () => {
  it("should create a connection pool", async () => {
    const pool = createPostgresPool(
      "postgresql://user:password@localhost:5432/querypal",
    );

    expect(pool).toBeDefined();

    await pool.end();
  });
});
