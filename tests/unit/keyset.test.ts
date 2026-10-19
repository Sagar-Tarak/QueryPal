import { describe, expect, it } from "vitest";
import { keysetSql } from "../../src/database/postgres/keyset.js";

describe("keysetSql", () => {
  it("keeps nullable cursor parameters untyped for composite sort keys", () => {
    const next = keysetSql({
      orderBy: [
        { column: "created_at", direction: "DESC" },
        { column: "id", direction: "ASC" },
      ],
      cursor: [null, 7],
    });
    const previous = keysetSql({
      orderBy: [
        { column: "created_at", direction: "DESC" },
        { column: "id", direction: "ASC" },
      ],
      cursor: [null, 7],
      before: true,
    });

    expect(next.predicate).toContain("FALSE AND $1 IS NULL");
    expect(next.predicate).toContain('"created_at" IS NOT DISTINCT FROM $1');
    expect(previous.predicate).toContain('"created_at" IS NOT NULL AND $1 IS NULL');
    expect(previous.predicate).toContain('"created_at" IS NOT DISTINCT FROM $1');
    expect(next.predicate).not.toContain("$1::text");
    expect(previous.predicate).not.toContain("$1::text");
  });
});
