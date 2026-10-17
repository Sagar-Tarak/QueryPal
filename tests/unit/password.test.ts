import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/config/keyring.js", () => ({ readSecret: vi.fn() }));

import { readSecret } from "../../src/config/keyring.js";
import { getPassword } from "../../src/config/password.js";
import { isLocalHost } from "../../src/config/profiles.js";

beforeEach(() => {
  vi.mocked(readSecret).mockReset();
  vi.stubEnv("QUERYPAL_PASSWORD", "from-env");
});

afterEach(() => vi.unstubAllEnvs());

describe("getPassword with the keyring", () => {
  it("should prefer the keyring over the env variable when the profile opted in", async () => {
    vi.mocked(readSecret).mockReturnValue("from-keyring");

    expect(await getPassword("shop", "keyring")).toBe("from-keyring");
  });

  it("should fall back to the env variable when nothing is saved", async () => {
    vi.mocked(readSecret).mockReturnValue(null);

    expect(await getPassword("shop", "keyring")).toBe("from-env");
  });

  it("should never touch the keyring for a prompt profile", async () => {
    expect(await getPassword("shop", "prompt")).toBe("from-env");
    expect(await getPassword("shop")).toBe("from-env");
    expect(readSecret).not.toHaveBeenCalled();
  });
});

describe("isLocalHost", () => {
  it("should treat only loopback names as local", () => {
    expect(["localhost", "127.0.0.1", "::1"].every(isLocalHost)).toBe(true);
    expect(isLocalHost("db.example.com")).toBe(false);
    expect(isLocalHost("10.0.0.5")).toBe(false);
  });
});
