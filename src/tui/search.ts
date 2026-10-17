import type { SearchFilter } from "../database/postgres/search-records.js";
import type { DatabaseTable } from "../database/postgres/tables.js";

// "Cash" searches every column. "name~Cash" searches one column, "id=7" matches it exactly.
// The part before = or ~ only counts as a column if the table really has it, so free text
// that happens to contain "=" is still searched as text.
export function parseSearch(
  text: string,
  columnNames: string[],
): { filter: SearchFilter } | { error: string } {
  const query = text.trim();

  if (!query) {
    return { error: "Type something to search." };
  }

  const at = query.search(/[=~]/);

  if (at > 0) {
    const column = query.slice(0, at);

    if (columnNames.includes(column)) {
      return { filter: { column, op: query[at] as "=" | "~", value: query.slice(at + 1) } };
    }
  }

  return { filter: { text: query } };
}

export const columnMatches = (name: string, filter: string): boolean =>
  name.toLowerCase().includes(filter.trim().toLowerCase());

// Table search. Words must all appear in "schema.table". "@text" instead keeps the tables
// that have a column whose name contains text.
export function matchTables(
  tables: DatabaseTable[],
  columnIndex: Record<string, string[]>,
  query: string,
): DatabaseTable[] {
  const q = query.trim().toLowerCase();

  if (!q) {
    return tables;
  }

  if (q.startsWith("@")) {
    const wanted = q.slice(1).trim();

    return tables.filter((t) =>
      (columnIndex[`${t.schema}.${t.name}`] ?? []).some((c) => c.toLowerCase().includes(wanted)),
    );
  }

  const terms = q.split(/\s+/);

  return tables.filter((t) => {
    const full = `${t.schema}.${t.name}`.toLowerCase();

    return terms.every((term) => full.includes(term));
  });
}
