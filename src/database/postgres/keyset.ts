import { quoteIdentifier } from "./quote.js";

export interface SortColumn {
  column: string;
  direction: "ASC" | "DESC";
}

export interface KeysetPage {
  orderBy: SortColumn[];
  cursor?: unknown[];
  before?: boolean;
}

export function keysetSql(page: KeysetPage, firstParameter = 1) {
  if (page.cursor && page.cursor.length !== page.orderBy.length) {
    throw new Error("The paging cursor does not match the sort columns.");
  }

  const before = page.before ?? false;
  const values = page.cursor ?? [];
  const predicate = page.cursor
    ? `(${page.orderBy
        .map((item, index) => {
          const prefix = page.orderBy
            .slice(0, index)
            .map(
              (prior, priorIndex) =>
                `${quoteIdentifier(prior.column)} IS NOT DISTINCT FROM $${firstParameter + priorIndex}`,
            );
          const column = quoteIdentifier(item.column);
          const value = values[index];
          const parameter = `$${firstParameter + index}`;
          const comparison =
            value == null
              ? before
                ? `${column} IS NOT NULL AND ${parameter} IS NULL`
                : `FALSE AND ${parameter} IS NULL`
              : before
                ? item.direction === "ASC"
                  ? `${column} < ${parameter}`
                  : `${column} > ${parameter}`
                : `(${column} ${item.direction === "ASC" ? ">" : "<"} ${parameter} OR ${column} IS NULL)`;
          return [...prefix, comparison].join(" AND ");
        })
        .join(" OR ")})`
    : "";
  const orderBy = page.orderBy
    .map(({ column, direction }) => {
      const reverseDirection = before ? (direction === "ASC" ? "DESC" : "ASC") : direction;
      return `${quoteIdentifier(column)} ${reverseDirection} NULLS ${before ? "FIRST" : "LAST"}`;
    })
    .join(", ");

  return { predicate, values, orderBy, reverse: before };
}
