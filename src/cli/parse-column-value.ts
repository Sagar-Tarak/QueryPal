export function parseColumnValue(text: string): { column: string; value: string } | null {
  const separator = text.indexOf("=");

  return separator > 0
    ? { column: text.slice(0, separator), value: text.slice(separator + 1) }
    : null;
}
