import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Pool } from "pg";
import { createPostgresPool } from "../../src/database/postgres/client.js";
import { mutateRecords } from "../../src/database/postgres/mutate-records.js";

const connectionString = process.env.QUERYPAL_TEST_DATABASE_URL;

describe.skipIf(!connectionString)("PostgreSQL access levels", () => {
  it("blocks writes in read-only sessions and permits them when opted in", async () => {
    const admin = new Pool({ connectionString });
    const schema = `querypal_test_${randomUUID().replaceAll("-", "")}`;
    const table = `"${schema}"."records"`;
    const readPool = createPostgresPool(connectionString!);
    const writePool = createPostgresPool(connectionString!, "readwrite");
    const backupDir = await mkdtemp(join(tmpdir(), "querypal-backup-"));
    const previousBackupDir = process.env.QUERYPAL_BACKUP_DIR;
    process.env.QUERYPAL_BACKUP_DIR = backupDir;

    try {
      await admin.query(`CREATE SCHEMA "${schema}"`);
      await admin.query(`CREATE TABLE ${table} (id integer PRIMARY KEY, name text)`);

      await expect(readPool.query(`INSERT INTO ${table} VALUES (1)`)).rejects.toMatchObject({
        code: "25006",
      });
      expect(
        (await readPool.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0]?.count,
      ).toBe(0);

      await writePool.query(`INSERT INTO ${table} VALUES (1, 'before')`);
      await writePool.query(`INSERT INTO ${table} VALUES (2, 'second')`);
      expect(
        (await admin.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0]?.count,
      ).toBe(2);

      await expect(
        mutateRecords(writePool, {
          schema,
          table: "records",
          filters: [{ column: "id", value: "1" }],
          mutation: { operation: "update", changes: [{ column: "name", value: "after" }] },
          limit: 100,
          source: "integration test",
          confirm: async (preview) => {
            expect(preview.rows).toEqual([{ id: 1, name: "before" }]);
            await admin.query(`UPDATE ${table} SET name = 'raced' WHERE id = 1`);
            return true;
          },
        }),
      ).rejects.toThrow("Rows changed after the preview");

      const update = await mutateRecords(writePool, {
        schema,
        table: "records",
        filters: [{ column: "id", value: "1" }],
        mutation: {
          operation: "update",
          changes: [
            { column: "id", value: "3" },
            { column: "name", value: "after" },
          ],
        },
        limit: 100,
        source: "integration test",
        confirm: async (preview) => {
          expect(preview.rows).toEqual([{ id: 1, name: "raced" }]);
          return true;
        },
      });
      expect(update).toMatchObject({ applied: true, count: 1, backupFinalized: true });
      expect((await admin.query(`SELECT name FROM ${table} WHERE id = 3`)).rows[0]?.name).toBe(
        "after",
      );
      expect(JSON.parse(await readFile(update.backupPath!, "utf8"))).toMatchObject({
        state: "committed",
        operation: "update",
        rows: [{ id: 1, name: "raced" }],
      });

      const deletingOne = {
        schema,
        table: "records",
        filters: [{ column: "id", value: "3" }],
        mutation: { operation: "delete" },
        limit: 100,
        source: "integration test",
        confirm: async (preview) => {
          expect(preview.rows).toEqual([{ id: 3, name: "after" }]);
          return true;
        },
      } as const;
      const deletion = await mutateRecords(writePool, deletingOne);
      expect(deletion).toMatchObject({ applied: true, count: 1, backupFinalized: true });

      await expect(
        mutateRecords(writePool, {
          ...deletingOne,
          filters: [{ column: "id", value: "2" }],
          confirm: async () => true,
        }),
      ).rejects.toThrow("matches every row");
      await mutateRecords(writePool, {
        ...deletingOne,
        filters: [{ column: "id", value: "2" }],
        allowAll: true,
        confirm: async () => true,
      });
      expect(
        (await admin.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0]?.count,
      ).toBe(0);
    } finally {
      await Promise.all([readPool.end(), writePool.end()]);
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
      if (previousBackupDir === undefined) delete process.env.QUERYPAL_BACKUP_DIR;
      else process.env.QUERYPAL_BACKUP_DIR = previousBackupDir;
      await rm(backupDir, { recursive: true, force: true });
    }
  });
});
