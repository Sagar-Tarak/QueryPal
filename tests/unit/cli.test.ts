import { describe, expect, it } from "vitest";
import { createCli } from "../../src/cli.js";

describe("QueryPal CLI", () => {
  it("should use the correct application name", () => {
    const program = createCli();

    expect(program.name()).toBe("querypal");
  });

  it("should define the version command", () => {
    const program = createCli();
    const versionCommand = program.commands.find(
      (command) => command.name() === "version",
    );

    expect(versionCommand).toBeDefined();
  });
});
