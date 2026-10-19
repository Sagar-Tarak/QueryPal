import { describe, expect, it } from "vitest";
import { createCli } from "../../src/cli.js";

describe("QueryPal CLI", () => {
  it("should use the correct application name", () => {
    const program = createCli();

    expect(program.name()).toBe("querypal");
  });

  it("should define the version command", () => {
    const program = createCli();
    const versionCommand = program.commands.find((command) => command.name() === "version");

    expect(versionCommand).toBeDefined();
  });

  it("should expose guarded update and delete commands", () => {
    const program = createCli();

    expect(
      program.commands.find((command) => command.name() === "update")?.helpInformation(),
    ).toContain("--yes");
    expect(
      program.commands.find((command) => command.name() === "update")?.helpInformation(),
    ).toContain("--all");
    expect(
      program.commands.find((command) => command.name() === "delete")?.helpInformation(),
    ).toContain("--where");
  });
});
