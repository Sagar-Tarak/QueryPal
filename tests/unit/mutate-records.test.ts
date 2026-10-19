import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import {
  assertMutationLimit,
  mutateRecords,
  parseMutationValue,
} from "../../src/database/postgres/mutate-records.js";

describe("mutation inputs", () => {
  it("uses uppercase NULL for SQL null and backslash to preserve the literal", () => {
    expect(parseMutationValue("NULL")).toBeNull();
    expect(parseMutationValue("\\NULL")).toBe("NULL");
    expect(parseMutationValue("null")).toBe("null");
    expect(parseMutationValue("")).toBe("");
  });

  it("keeps mutation limits bounded to 1 through 100", () => {
    expect(() => assertMutationLimit(1)).not.toThrow();
    expect(() => assertMutationLimit(100)).not.toThrow();
    expect(() => assertMutationLimit(0)).toThrow("Limit");
    expect(() => assertMutationLimit(101)).toThrow("Limit");
    expect(() => assertMutationLimit(1.5)).toThrow("Limit");
  });

  it("rolls back and skips the write if it cannot create the pre-change backup", async () => {
    const dir = await mkdtemp(join(tmpdir(), "querypal-backup-test-"));
    const blocker = join(dir, "not-a-directory");
    await writeFile(blocker, "block mkdir");
    const previousBackupDir = process.env.QUERYPAL_BACKUP_DIR;
    process.env.QUERYPAL_BACKUP_DIR = blocker;

    const query = vi.fn(async (sql: string) => {
      if (sql.includes("information_schema.tables"))
        return { rows: [{ table_type: "BASE TABLE" }] };
      if (sql.includes("information_schema.columns")) return { rows: [{ column_name: "id" }] };
      if (sql.includes("SELECT EXISTS")) return { rows: [{ exists: true }] };
      if (sql.includes("FOR UPDATE")) return { rows: [{ __querypal_ctid: "(0,1)", id: 1 }] };
      if (sql.includes("SELECT ctid::text")) return { rows: [{ __querypal_ctid: "(0,1)", id: 1 }] };
      return { rows: [], rowCount: 1 };
    });
    const client = { query, release: vi.fn() };
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool;

    try {
      await expect(
        mutateRecords(pool, {
          schema: "public",
          table: "users",
          filters: [{ column: "id", value: "1" }],
          mutation: { operation: "delete" },
          limit: 1,
          allowAll: true,
          source: "test",
          confirm: async () => true,
        }),
      ).rejects.toThrow();

      expect(query).toHaveBeenCalledWith("ROLLBACK");
      expect(query.mock.calls.some(([sql]) => sql.startsWith("DELETE FROM"))).toBe(false);
      expect(client.release).toHaveBeenCalledOnce();
    } finally {
      if (previousBackupDir === undefined) delete process.env.QUERYPAL_BACKUP_DIR;
      else process.env.QUERYPAL_BACKUP_DIR = previousBackupDir;
      await rm(dir, { recursive: true, force: true });
    }
  });
});
