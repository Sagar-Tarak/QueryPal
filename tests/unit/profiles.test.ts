import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  addProfile,
  buildConnectionString,
  loadConfig,
  removeProfile,
  saveConfig,
  setDefault,
} from "../../src/config/profiles.js";

const profile = { host: "localhost", port: 5432, database: "app", user: "me" };

describe("profiles", () => {
  it("should encode special characters in the connection string", () => {
    expect(buildConnectionString({ ...profile, user: "a@b" }, "p@ss/w:rd")).toBe(
      "postgresql://a%40b:p%40ss%2Fw%3Ard@localhost:5432/app",
    );
  });

  it("should return an empty config when the file is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "querypal-"));

    expect(await loadConfig(dir)).toEqual({ profiles: {} });
  });

  it("should save and load a config with owner-only permissions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "querypal-"));
    const config = addProfile({ profiles: {} }, "local", profile);

    await saveConfig(config, dir);

    expect(await loadConfig(dir)).toEqual(config);
    expect((await stat(join(dir, "config.json"))).mode & 0o777).toBe(0o600);
  });

  it("should make only the first profile the default", () => {
    const first = addProfile({ profiles: {} }, "local", profile);
    const second = addProfile(first, "staging", profile);

    expect(second.defaultProfile).toBe("local");
    expect(Object.keys(second.profiles)).toEqual(["local", "staging"]);
  });

  it("should remember a database override and forget it when the profile changes", () => {
    const base = addProfile(addProfile({ profiles: {} }, "a", profile), "b", profile);
    const withDb = setDefault(base, "a", "other");

    expect(withDb).toMatchObject({ defaultProfile: "a", defaultDatabase: "other" });
    expect(setDefault(withDb, "b").defaultDatabase).toBeUndefined();
    expect(setDefault(withDb, "a").defaultDatabase).toBeUndefined();
  });

  it("should keep the database override when another profile is added", () => {
    const withDb = setDefault(addProfile({ profiles: {} }, "a", profile), "a", "other");

    expect(addProfile(withDb, "b", profile).defaultDatabase).toBe("other");
  });

  it("should drop the default and its override when the default profile is removed", () => {
    const config = setDefault(addProfile(addProfile({ profiles: {} }, "a", profile), "b", profile), "a", "x");

    expect(removeProfile(config, "a")).toEqual({ profiles: { b: profile } });
    expect(removeProfile(config, "b")).toMatchObject({ defaultProfile: "a", defaultDatabase: "x" });
  });

  it("should never write a password into the config file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "querypal-"));

    await saveConfig(addProfile({ profiles: {} }, "local", profile), dir);

    expect(JSON.stringify(await loadConfig(dir))).not.toContain("password");
  });
});
