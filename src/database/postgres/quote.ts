export const quoteIdentifier = (identifier: string): string =>
  `"${identifier.replace(/"/g, '""')}"`;
