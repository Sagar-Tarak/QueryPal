import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveConnection } from "../../src/config/connection.js";
import { getPassword } from "../../src/config/password.js";
import { addProfile, saveConfig, setDefault } from "../../src/config/profiles.js";

const profile = { host: "db.local", port: 5433, database: "app", user: "me" };

beforeEach(async () => {
  vi.stubEnv("QUERYPAL_CONFIG_DIR", await mkdtemp(join(tmpdir(), "querypal-")));
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("QUERYPAL_PASSWORD", "secret");
  Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
});

afterEach(() => vi.unstubAllEnvs());

describe("resolveConnection", () => {
  it("should use DATABASE_URL when no profile is requested", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://env/db");

    expect(await resolveConnection()).toEqual({
      connectionString: "postgresql://env/db",
      source: "DATABASE_URL",
    });
  });

  it("should use the default profile and the env password", async () => {
    await saveConfig(addProfile({ profiles: {} }, "local", profile));

    expect(await resolveConnection()).toEqual({
      connectionString: "postgresql://me:secret@db.local:5433/app",
      source: 'profile "local" (default)',
    });
  });

  it("should let --profile beat DATABASE_URL", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://env/db");
    await saveConfig(addProfile({ profiles: {} }, "local", profile));

    const resolved = await resolveConnection("local");

    expect(resolved.connectionString).toContain("db.local");
    expect(resolved.source).toBe('profile "local"');
  });

  it("should swap only the database name, keeping user, password and host", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://me:p%40ss@db.local:5433/app?sslmode=require");

    const resolved = await resolveConnection(undefined, "testDB");

    expect(resolved.connectionString).toBe(
      "postgresql://me:p%40ss@db.local:5433/testDB?sslmode=require",
    );
    expect(resolved.source).toBe('DATABASE_URL, database "testDB"');
  });

  it("should apply --database on top of a profile", async () => {
    await saveConfig(addProfile({ profiles: {} }, "local", profile));

    expect((await resolveConnection("local", "other db")).connectionString).toBe(
      "postgresql://me:secret@db.local:5433/other%20db",
    );
  });

  it("should use the saved database on the default profile only", async () => {
    await saveConfig(setDefault(addProfile({ profiles: {} }, "local", profile), "local", "other"));

    const fromDefault = await resolveConnection();

    expect(fromDefault.connectionString).toBe("postgresql://me:secret@db.local:5433/other");
    expect(fromDefault.source).toBe('profile "local" (default), database "other" (saved)');
    expect((await resolveConnection("local")).connectionString).toContain("/app");
  });

  it("should let --database beat the saved database", async () => {
    await saveConfig(setDefault(addProfile({ profiles: {} }, "local", profile), "local", "other"));

    expect((await resolveConnection(undefined, "flag")).connectionString).toContain("/flag");
  });

  it("should ignore the saved database when DATABASE_URL is set", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://env/db");
    await saveConfig(setDefault(addProfile({ profiles: {} }, "local", profile), "local", "other"));

    expect((await resolveConnection()).connectionString).toBe("postgresql://env/db");
  });

  it("should reject an unknown profile", async () => {
    await expect(resolveConnection("nope")).rejects.toThrow('Profile "nope" not found');
  });

  it("should fail with a hint when nothing is configured and there is no terminal", async () => {
    await expect(resolveConnection()).rejects.toThrow("querypal init");
  });
});

describe("getPassword", () => {
  it("should accept an empty QUERYPAL_PASSWORD", async () => {
    vi.stubEnv("QUERYPAL_PASSWORD", "");

    expect(await getPassword("local")).toBe("");
  });

  it("should fail without env password when there is no terminal", async () => {
    vi.unstubAllEnvs();
    delete process.env.QUERYPAL_PASSWORD;

    await expect(getPassword("local")).rejects.toThrow("QUERYPAL_PASSWORD");
  });
});
