export const cellText = (value: unknown): string =>
  value === null || value === undefined
    ? "NULL"
    : value instanceof Date
      ? value.toISOString()
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);

export type CellKind = "null" | "number" | "boolean" | "text";
export interface Cell {
  text: string;
  kind: CellKind;
}

const kindOf = (value: unknown): CellKind =>
  value === null || value === undefined
    ? "null"
    : typeof value === "number" || typeof value === "bigint"
      ? "number"
      : typeof value === "boolean"
        ? "boolean"
        : "text";

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const MIN_CELL = 4;
const MAX_CELL = 28;
const MAX_KEY = 28;

const fit = (value: unknown, width: number, alignRight = false): string => {
  const s = cellText(value);

  if (s.length > width) {
    return `${s.slice(0, width - 1)}…`;
  }

  return alignRight ? s.padStart(width) : s.padEnd(width);
};

export interface Grid {
  header: string[];
  rows: Cell[][];
  first: number; // index of the first column shown
  shown: number; // how many columns fit
  total: number;
}

// Sizes each column to its content (capped), then shows as many as fit starting at `firstColumn`.
// The rest are reached by scrolling sideways, so nothing is squeezed into an unreadable width.
export function formatTable(
  records: Record<string, unknown>[],
  totalWidth: number,
  firstColumn = 0,
): Grid | null {
  const all = Object.keys(records[0] ?? {});

  if (all.length === 0) {
    return null;
  }

  const first = clamp(firstColumn, 0, all.length - 1);
  const chosen: { column: string; width: number; wanted: number }[] = [];
  let used = 0;

  for (const column of all.slice(first)) {
    const wanted = Math.max(
      column.length,
      ...records.map((record) => cellText(record[column]).length),
    );
    const width = Math.min(clamp(wanted, MIN_CELL, MAX_CELL), totalWidth);
    const need = width + (chosen.length ? 1 : 0);

    if (chosen.length && used + need > totalWidth) {
      break;
    }

    chosen.push({ column, width, wanted });
    used += need;
  }

  // Spare room goes to columns that were cut short.
  let spare = totalWidth - used;

  for (const c of chosen) {
    const extra = Math.min(c.wanted - c.width, spare);

    if (extra > 0) {
      c.width += extra;
      spare -= extra;
    }
  }

  return {
    header: chosen.map((c) => fit(c.column, c.width)),
    rows: records.map((record) =>
      chosen.map((c) => ({
        text: fit(record[c.column], c.width, typeof record[c.column] === "number"),
        kind: kindOf(record[c.column]),
      })),
    ),
    first,
    shown: chosen.length,
    total: all.length,
  };
}

// The same table as plain lines (header, then one per record) that fit `totalWidth`.
export function formatRows(
  records: Record<string, unknown>[],
  totalWidth: number,
  firstColumn = 0,
): string[] {
  const table = formatTable(records, totalWidth, firstColumn);

  return table
    ? [table.header.join(" "), ...table.rows.map((row) => row.map((cell) => cell.text).join(" "))]
    : [];
}

export interface DetailEntry {
  key: string;
  value: string;
  kind: CellKind;
}

// One record as "column / full value" entries, nothing truncated except very long column names.
export function formatDetail(record: Record<string, unknown>): DetailEntry[] {
  const keys = Object.keys(record);
  const keyWidth = Math.min(MAX_KEY, Math.max(...keys.map((key) => key.length)));

  return keys.map((key) => ({
    key: fit(key, keyWidth),
    value: cellText(record[key]),
    kind: kindOf(record[key]),
  }));
}

// Shows `size` items around the selected one, so long lists scroll.
export function visibleWindow(total: number, selected: number, size: number) {
  const start = Math.max(0, Math.min(selected - Math.floor(size / 2), total - size));

  return { start, end: Math.min(total, start + size) };
}
