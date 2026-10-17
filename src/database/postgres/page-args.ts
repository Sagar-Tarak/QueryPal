// Limit and offset go into the SQL text, so they must be plain whole numbers.
export function assertPageArgs(limit: number, offset: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Limit must be a whole number from 1 to 100.");
  }

  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error("Offset must be a whole number, 0 or more.");
  }
}
