import { describe, expect, it } from "vitest";
import { explainError } from "../../src/database/postgres/errors.js";

const withCode = (message: string, code: string) => Object.assign(new Error(message), { code });

describe("explainError", () => {
  it("should explain a refused connection even when the message is empty", () => {
    expect(explainError(withCode("", "ECONNREFUSED"))).toContain("Is PostgreSQL running");
  });

  it("should explain a wrong password", () => {
    expect(explainError(withCode("password authentication failed", "28P01"))).toContain(
      "Wrong username or password",
    );
  });

  it("should explain permission denied", () => {
    expect(explainError(withCode("permission denied for table users", "42501"))).toContain(
      "Permission denied",
    );
  });

  it("should explain pg's connect timeout", () => {
    expect(explainError(new Error("timeout exceeded when trying to connect"))).toContain(
      "timed out",
    );
  });

  it("should fall back to the original message", () => {
    expect(explainError(new Error('Column "x" was not found.'))).toBe('Column "x" was not found.');
  });
});
