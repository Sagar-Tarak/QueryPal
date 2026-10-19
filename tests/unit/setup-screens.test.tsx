import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render } from "ink-testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  end: vi.fn(),
  saveSecret: vi.fn(),
  readSecret: vi.fn(),
  deleteSecret: vi.fn(),
}));

vi.mock("../../src/database/postgres/client.js", () => ({
  createPostgresPool: () => ({ query: mocks.query, end: mocks.end }),
  withPostgresPool: async (
    _connectionString: string,
    _accessLevel: string,
    run: (pool: unknown) => Promise<unknown>,
  ) => {
    try {
      return await run({ query: mocks.query, end: mocks.end });
    } finally {
      await mocks.end();
    }
  },
}));
vi.mock("../../src/config/keyring.js", () => ({
  saveSecret: mocks.saveSecret,
  readSecret: mocks.readSecret,
  deleteSecret: mocks.deleteSecret,
}));

import { addProfile, loadConfig, saveConfig, setDefault } from "../../src/config/profiles.js";
import { saveProfile } from "../../src/config/save-profile.js";
import { editText } from "../../src/tui/edit-text.js";
import { FormScreen } from "../../src/tui/form-screen.js";
import { ProfilesScreen } from "../../src/tui/profiles-screen.js";

const wait = () => new Promise((resolve) => setTimeout(resolve, 80));
const press = async (stdin: { write: (s: string) => void }, ...keys: string[]) => {
  for (const key of keys) {
    stdin.write(key);
    await wait();
  }
};
const type = (text: string) => [...text];

const profile = { host: "localhost", port: 5432, database: "app", user: "me" };
const CONNECTED = { rows: [{ database: "app", user: "me", version: "17.1" }] };

beforeEach(async () => {
  vi.stubEnv("QUERYPAL_CONFIG_DIR", await mkdtemp(join(tmpdir(), "querypal-")));
  delete process.env.QUERYPAL_PASSWORD; // "" would count as a password that is set
  mocks.query.mockReset().mockResolvedValue(CONNECTED);
  mocks.end.mockReset().mockResolvedValue(undefined);
  mocks.saveSecret.mockReset().mockReturnValue(true);
  mocks.readSecret.mockReset().mockReturnValue(null);
  mocks.deleteSecret.mockReset();
});

afterEach(() => vi.unstubAllEnvs());

describe("editText", () => {
  const key = (over: object = {}) =>
    ({
      backspace: false,
      delete: false,
      ctrl: false,
      meta: false,
      return: false,
      escape: false,
      tab: false,
      ...over,
    }) as never;

  it("should add typed characters and remove with backspace or delete", () => {
    expect(editText("ab", "c", key())).toBe("abc");
    expect(editText("abc", "", key({ backspace: true }))).toBe("ab");
    expect(editText("abc", "", key({ delete: true }))).toBe("ab");
  });

  it("should ignore keys that are not text", () => {
    expect(editText("ab", "", key())).toBeNull();
    expect(editText("ab", "x", key({ ctrl: true }))).toBeNull();
    expect(editText("ab", "\r", key({ return: true }))).toBeNull();
    expect(editText("ab", "", key({ tab: true }))).toBeNull();
  });
});

describe("saveProfile", () => {
  it("should keep the password in the keyring and out of the config file", async () => {
    const result = await saveProfile({ name: "a", profile, password: "secret", wantKeyring: true });

    expect(result).toEqual({ storage: "keyring", keyringFailed: false });
    expect(mocks.saveSecret).toHaveBeenCalledWith("a", "secret");
    expect(JSON.stringify(await loadConfig())).not.toContain("secret");
    expect((await loadConfig()).profiles.a).toMatchObject({ passwordStorage: "keyring" });
  });

  it("should default saved profiles to read-only", async () => {
    await saveProfile({ name: "a", profile, password: "secret", wantKeyring: false });

    expect((await loadConfig()).profiles.a?.accessLevel).toBeUndefined();
  });

  it("should persist explicit read-write access", async () => {
    await saveProfile({
      name: "a",
      profile: { ...profile, accessLevel: "readwrite" },
      password: "secret",
      wantKeyring: false,
    });

    expect((await loadConfig()).profiles.a?.accessLevel).toBe("readwrite");
  });

  it("should fall back to asking each time when the keyring is unavailable", async () => {
    mocks.saveSecret.mockReturnValue(false);

    expect(await saveProfile({ name: "a", profile, password: "x", wantKeyring: true })).toEqual({
      storage: "prompt",
      keyringFailed: true,
    });
    expect(mocks.deleteSecret).toHaveBeenCalledWith("a");
  });

  it("should delete an old saved password when the user opts out", async () => {
    await saveProfile({ name: "a", profile, password: "x", wantKeyring: false });

    expect(mocks.saveSecret).not.toHaveBeenCalled();
    expect(mocks.deleteSecret).toHaveBeenCalledWith("a");
  });

  it("should keep the stored password when editing without a new one", async () => {
    mocks.readSecret.mockReturnValue("old");

    expect((await saveProfile({ name: "a", profile, wantKeyring: true })).storage).toBe("keyring");
    expect(mocks.saveSecret).not.toHaveBeenCalled();
    expect(mocks.deleteSecret).not.toHaveBeenCalled();
  });

  it("should keep keyring storage when the keyring cannot read the unchanged password", async () => {
    mocks.readSecret.mockReturnValue(null);

    expect((await saveProfile({ name: "a", profile, wantKeyring: true })).storage).toBe("keyring");
    expect(mocks.deleteSecret).not.toHaveBeenCalled();
  });

  it("should keep the default profile and saved database of the config", async () => {
    await saveConfig(
      setDefault(addProfile({ profiles: {} }, "first", profile), "first", "other_db"),
    );
    await saveProfile({ name: "second", profile, password: "x", wantKeyring: false });

    expect(await loadConfig()).toMatchObject({
      defaultProfile: "first",
      defaultDatabase: "other_db",
    });
  });
});

const fillForm = async (
  stdin: { write: (s: string) => void },
  over: Partial<Record<string, string>> = {},
) => {
  const v = { name: "dev", host: "", database: "app", user: "me", password: "pw", ...over };

  await press(stdin, ...type(v.name), "\r");
  await press(stdin, ...type(v.host)); // host starts as "localhost": typing appends to it
  await press(
    stdin,
    "\r",
    "\r",
    ...type(v.database),
    "\r",
    ...type(v.user),
    "\r",
    ...type(v.password),
  );
};

describe("FormScreen", () => {
  const open = async (props: Partial<Parameters<typeof FormScreen>[0]> = {}) => {
    const onSaved = vi.fn();
    const onCancel = vi.fn();
    const app = render(
      <FormScreen config={{ profiles: {} }} onSaved={onSaved} onCancel={onCancel} {...props} />,
    );

    await wait();

    return { ...app, onSaved, onCancel };
  };

  it("should show the fields with sensible defaults", async () => {
    const { lastFrame } = await open();

    expect(lastFrame()).toContain("New connection");
    expect(lastFrame()).toContain("localhost");
    expect(lastFrame()).toContain("5432");
    expect(lastFrame()).toContain("[x] Save the password in the OS keyring");
    expect(lastFrame()).toContain("[ ] Allow writes for this profile");
  });

  it("should require an explicit opt-in to save a read-write profile", async () => {
    const { stdin, onSaved } = await open();

    await fillForm(stdin);
    await press(stdin, "\u001B[B", "\u001B[B", " ", "\u001B[B", "\r");
    await wait();

    expect(onSaved.mock.calls[0]?.[0].profile.accessLevel).toBe("readwrite");
  });

  it("should mask the password and explain missing fields", async () => {
    const { lastFrame, stdin } = await open();

    await press(
      stdin,
      "\u001B[B",
      "\u001B[B",
      "\u001B[B",
      "\u001B[B",
      "\u001B[B",
      "s",
      "e",
      "c",
      "\u001B[B",
      "\u001B[B",
      "\u001B[B",
      "\r",
    );

    expect(lastFrame()).toContain("***");
    expect(lastFrame()).not.toContain("sec");
    expect(lastFrame()).toContain("Give the profile a name.");
  });

  it("should reject a bad port and an existing name", async () => {
    const { lastFrame, stdin } = await open({
      config: addProfile({ profiles: {} }, "dev", profile),
    });

    await fillForm(stdin);
    await press(stdin, "\u001B[B", "\u001B[B", "\u001B[B", "\r");
    expect(lastFrame()).toContain('Profile "dev" already exists');

    const second = await open();

    await press(second.stdin, ..."x", "\r", "\r", ..."a", "\r");
    await press(
      second.stdin,
      "\u001B[B",
      "\u001B[B",
      "\u001B[B",
      "\u001B[B",
      "\u001B[B",
      "\u001B[B",
      "\u001B[B",
      "\r",
    );
    expect(second.lastFrame()).toContain("Port must be a number");
  });

  it("should test the connection, then save the profile without the password in the file", async () => {
    const { lastFrame, stdin, onSaved } = await open();

    await fillForm(stdin);
    await press(stdin, "\u001B[B", "\u001B[B", "\u001B[B", "\r");
    await wait();

    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onSaved.mock.calls[0]![0]).toMatchObject({
      name: "dev",
      password: "pw",
      profile: { host: "localhost", port: 5432, database: "app", user: "me", accessLevel: "read" },
    });
    expect(mocks.saveSecret).toHaveBeenCalledWith("dev", "pw");
    expect(mocks.end).toHaveBeenCalled();
    expect(JSON.stringify(await loadConfig())).not.toContain('"pw"');
    expect(lastFrame()).toBeDefined();
  });

  it("should show why a test failed and save anyway on a second Enter", async () => {
    mocks.query.mockRejectedValue(Object.assign(new Error("nope"), { code: "28P01" }));
    const { lastFrame, stdin, onSaved } = await open();

    await fillForm(stdin);
    await press(stdin, "\u001B[B", "\u001B[B", "\u001B[B", "\r");
    await wait();

    expect(lastFrame()).toContain("Connection failed: Wrong username or password");
    expect(lastFrame()).toContain("[ Save anyway ]");
    expect(onSaved).not.toHaveBeenCalled();

    await press(stdin, "\r");
    await wait();

    expect(onSaved).toHaveBeenCalledTimes(1);
    expect((await loadConfig()).profiles.dev).toBeDefined();
  });

  it("should switch the keyring default off for a remote host, and let the user opt in", async () => {
    const { lastFrame, stdin } = await open();

    await press(stdin, "\u001B[B"); // to Host
    for (let i = 0; i < 9; i++) {
      stdin.write("\u007f");
    }

    await wait();
    await press(stdin, ...type("db.example.com"));

    expect(lastFrame()).toContain("[ ] Save the password in the OS keyring");
    expect(lastFrame()).toContain("remote: asked each time");

    await press(stdin, "\u001B[B", "\u001B[B", "\u001B[B", "\u001B[B", "\u001B[B", " ");
    expect(lastFrame()).toContain("[x] Save the password in the OS keyring");
    expect(lastFrame()).toContain("remote host: not recommended");
  });

  it("should keep the name fixed and the password unchanged when editing", async () => {
    mocks.readSecret.mockReturnValue("stored");
    const config = addProfile({ profiles: {} }, "dev", {
      ...profile,
      passwordStorage: "keyring",
    } as never);
    const { lastFrame, stdin, onSaved } = await open({ config, editing: "dev" });

    expect(lastFrame()).toContain("Edit profile · dev");
    expect(lastFrame()).toContain("(unchanged)");

    await press(stdin, "\u001B[A"); // already on the first editable row: stays there
    await press(stdin, ..."2"); // appends to the host
    await press(
      stdin,
      "\u001B[B",
      "\u001B[B",
      "\u001B[B",
      "\u001B[B",
      "\u001B[B",
      "\u001B[B",
      "\u001B[B",
      "\r",
    );
    await wait();

    expect(onSaved.mock.calls[0]![0]).toMatchObject({ name: "dev", password: "stored" });
    expect(mocks.saveSecret).not.toHaveBeenCalled();
    expect((await loadConfig()).profiles.dev).toMatchObject({
      host: "localhost2",
      passwordStorage: "keyring",
    });
  });

  it("should cancel with Esc", async () => {
    const { stdin, onCancel } = await open();

    await press(stdin, "\u001B");

    expect(onCancel).toHaveBeenCalled();
  });
});

describe("ProfilesScreen", () => {
  const seed = async () =>
    saveConfig(
      setDefault(
        addProfile(
          addProfile({ profiles: {} }, "local", { ...profile, passwordStorage: "keyring" }),
          "staging",
          {
            ...profile,
            database: "stage",
            passwordStorage: "prompt",
          },
        ),
        "local",
      ),
    );

  const open = async () => {
    await seed();
    mocks.readSecret.mockReturnValue("stored");

    const handlers = {
      onConnect: vi.fn(),
      onAdd: vi.fn(),
      onEdit: vi.fn(),
      onBack: vi.fn(),
      onQuit: vi.fn(),
    };
    const app = render(<ProfilesScreen {...handlers} />);

    await wait();

    return { ...app, ...handlers };
  };

  it("should list profiles, mark the default, and show details", async () => {
    const { lastFrame } = await open();

    expect(lastFrame()).toContain("Servers 2");
    expect(lastFrame()).toContain("* local");
    expect(lastFrame()).toContain("  staging");
    expect(lastFrame()).toContain("localhost:5432");
    expect(lastFrame()).toContain("in the OS keyring");
  });

  it("should connect with Enter using the keyring password", async () => {
    const { lastFrame, stdin, onConnect } = await open();

    await press(stdin, "\r");
    await wait();

    expect(lastFrame()).not.toContain("password for");
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(onConnect.mock.calls[0]![0]).toMatchObject({ source: 'profile "local"' });
  });

  it("should make the chosen profile the default once it connects", async () => {
    const { stdin, onConnect } = await open();

    await press(stdin, "\u001B[B", "\r", ...type("pw"), "\r"); // staging asks each time
    await wait();

    expect(onConnect.mock.calls[0]![0]).toMatchObject({ source: 'profile "staging"' });
    expect((await loadConfig()).defaultProfile).toBe("staging");
  });

  it("should ask for the password when none is stored", async () => {
    const { lastFrame, stdin, onConnect } = await open();

    mocks.readSecret.mockReturnValue(null);
    await press(stdin, "\r");
    expect(lastFrame()).toContain("password for local:");

    await press(stdin, ...type("typed"));
    expect(lastFrame()).toContain("*****");
    expect(lastFrame()).not.toContain("typed");

    await press(stdin, "\r");
    await wait();
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it("should report a failed connection instead of switching", async () => {
    const { lastFrame, stdin, onConnect } = await open();

    mocks.query.mockRejectedValue(Object.assign(new Error("x"), { code: "ECONNREFUSED" }));
    await press(stdin, "\r");
    await wait();

    expect(lastFrame()).toContain("Connection refused");
    expect(onConnect).not.toHaveBeenCalled();
  });

  it("should test a profile without switching to it", async () => {
    const { lastFrame, stdin, onConnect } = await open();

    await press(stdin, "t");
    await wait();

    expect(lastFrame()).toContain('local: connected to "app" as me · PostgreSQL 17.1');
    expect(onConnect).not.toHaveBeenCalled();
  });

  it("should open another database on the same server and save it as the override", async () => {
    const { stdin, onConnect } = await open();

    await press(stdin, "o", ...type("reports"), "\r");
    await wait();

    expect(onConnect.mock.calls[0]![0]).toMatchObject({
      source: 'profile "local", database "reports"',
    });
    expect(await loadConfig()).toMatchObject({
      defaultProfile: "local",
      defaultDatabase: "reports",
    });
  });

  it("should keep the selected database visible in a long database list", async () => {
    const { lastFrame, stdin } = await open();
    const databases = Array.from({ length: 30 }, (_, i) => ({ datname: `db${i}` }));
    mocks.query
      .mockReset()
      .mockResolvedValueOnce(CONNECTED)
      .mockResolvedValueOnce({ rows: databases });

    await press(stdin, "d");
    await wait();
    await press(stdin, ...Array(20).fill("\u001B[B"));

    expect(lastFrame()).toContain("db20");
    expect(lastFrame()).not.toContain("db0");
  });

  it("should delete only after a y, and clean up the saved password", async () => {
    const { lastFrame, stdin } = await open();

    await press(stdin, "x");
    expect(lastFrame()).toContain('Delete profile "local"');

    await press(stdin, "n");
    expect(Object.keys((await loadConfig()).profiles)).toEqual(["local", "staging"]);

    await press(stdin, "x", "y");
    await wait();

    expect(Object.keys((await loadConfig()).profiles)).toEqual(["staging"]);
    expect(mocks.deleteSecret).toHaveBeenCalledWith("local");
    expect((await loadConfig()).defaultProfile).toBeUndefined();
  });

  it("should hand add, edit, back and quit to the caller", async () => {
    const { stdin, onAdd, onEdit, onBack, onQuit } = await open();

    await press(stdin, "a");
    expect(onAdd).toHaveBeenCalled();

    await press(stdin, "e");
    expect(onEdit).toHaveBeenCalledWith("local");

    await press(stdin, "\u001B");
    expect(onBack).toHaveBeenCalled();

    await press(stdin, "q");
    expect(onQuit).toHaveBeenCalled();
  });

  it("should invite the user to add a profile when there are none", async () => {
    const app = render(
      <ProfilesScreen
        onConnect={vi.fn()}
        onAdd={vi.fn()}
        onEdit={vi.fn()}
        onBack={vi.fn()}
        onQuit={vi.fn()}
      />,
    );

    await wait();

    expect(app.lastFrame()).toContain("Press a to add a server.");
  });
});
