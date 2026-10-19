import { Box, Text, useInput, useWindowSize } from "ink";
import { useState } from "react";
import { lookupPassword } from "../config/password.js";
import {
  buildConnectionString,
  isLocalHost,
  type Config,
  type Profile,
} from "../config/profiles.js";
import { saveProfile } from "../config/save-profile.js";
import { checkConnection } from "../database/postgres/check-connection.js";
import { withPostgresPool } from "../database/postgres/client.js";
import { explainError } from "../database/postgres/errors.js";
import { editText } from "./edit-text.js";
import { Panel } from "./panel.js";
import { StatusBar } from "./status-bar.js";
import { theme } from "./theme.js";

const FIELDS = [
  { key: "name", label: "Name", hint: "e.g. local, staging" },
  { key: "host", label: "Host", hint: "" },
  { key: "port", label: "Port", hint: "" },
  { key: "database", label: "Database", hint: "" },
  { key: "user", label: "User", hint: "" },
  { key: "password", label: "Password", hint: "" },
] as const;
type FieldKey = (typeof FIELDS)[number]["key"];

const KEYRING_ROW = FIELDS.length;
const ACCESS_ROW = FIELDS.length + 1;
const SAVE_ROW = FIELDS.length + 2;

type Status =
  | { kind: "idle" }
  | { kind: "busy"; text: string }
  | { kind: "error"; text: string }
  | { kind: "failed"; text: string };

export interface SavedProfile {
  name: string;
  profile: Profile;
  password: string;
  keyringFailed: boolean;
}

// Add or edit a connection profile: fields, a keyring toggle, then "Test & save".
export function FormScreen(props: {
  config: Config;
  editing?: string;
  onCancel: () => void;
  onSaved: (saved: SavedProfile) => void;
}) {
  const { columns } = useWindowSize();
  const { config, editing } = props;
  const existing = editing ? config.profiles[editing] : undefined;
  const firstRow = editing ? 1 : 0; // a profile's name is fixed once saved

  const [values, setValues] = useState<Record<FieldKey, string>>({
    name: editing ?? "",
    host: existing?.host ?? "localhost",
    port: String(existing?.port ?? 5432),
    database: existing?.database ?? "",
    user: existing?.user ?? "",
    password: "",
  });
  const [keyring, setKeyring] = useState(existing ? existing.passwordStorage === "keyring" : true);
  const [readwrite, setReadwrite] = useState(existing?.accessLevel === "readwrite");
  const [touched, setTouched] = useState(!!existing); // true once the user chose the keyring option
  const [row, setRow] = useState(firstRow);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const change = (key: FieldKey, value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    setStatus({ kind: "idle" });

    if (key === "host" && !touched) {
      setKeyring(isLocalHost(value.trim()));
    }
  };

  const problem = (): string | null => {
    const name = values.name.trim();

    if (!name) return "Give the profile a name.";
    if (!editing && config.profiles[name])
      return `Profile "${name}" already exists. Edit it from the list instead.`;
    if (!values.host.trim()) return "Host is required.";
    if (!/^\d+$/.test(values.port) || Number(values.port) < 1 || Number(values.port) > 65535)
      return "Port must be a number from 1 to 65535.";
    if (!values.database.trim()) return "Database name is required.";
    if (!values.user.trim()) return "User is required.";

    return null;
  };

  const submit = async (saveAnyway: boolean) => {
    const invalid = problem();

    if (invalid) {
      setStatus({ kind: "error", text: invalid });
      return;
    }

    const name = values.name.trim();
    const profile = {
      host: values.host.trim(),
      port: Number(values.port),
      database: values.database.trim(),
      user: values.user.trim(),
      accessLevel: readwrite ? ("readwrite" as const) : ("read" as const),
    };
    // While editing, an empty password field means "keep the current one".
    const changed = !editing || values.password !== "";
    const password = changed ? values.password : lookupPassword(name, existing?.passwordStorage);

    if (password === null) {
      setStatus({ kind: "error", text: "Enter the password to test the connection." });
      return;
    }

    if (!saveAnyway) {
      setStatus({ kind: "busy", text: "Testing connection…" });

      try {
        await withPostgresPool(
          buildConnectionString(profile, password),
          profile.accessLevel ?? "read",
          checkConnection,
        );
      } catch (error) {
        setStatus({ kind: "failed", text: explainError(error) });
        return;
      }
    }

    setStatus({ kind: "busy", text: "Saving…" });

    try {
      const { keyringFailed } = await saveProfile({
        name,
        profile,
        password: changed ? values.password : undefined,
        wantKeyring: keyring,
      });

      props.onSaved({ name, profile, password, keyringFailed });
    } catch (error) {
      setStatus({ kind: "error", text: explainError(error) });
    }
  };

  useInput((input, key) => {
    if (status.kind === "busy") {
      return;
    }

    if (key.escape) {
      props.onCancel();
    } else if (key.downArrow || (key.tab && !key.shift)) {
      setRow((r) => Math.min(r + 1, SAVE_ROW));
    } else if (key.upArrow || (key.tab && key.shift)) {
      setRow((r) => Math.max(r - 1, firstRow));
    } else if (row < FIELDS.length) {
      const field = FIELDS[row]!;

      if (key.return) {
        setRow(row + 1);
      } else {
        const next = editText(values[field.key], input, key);

        if (next !== null) {
          change(field.key, next);
        }
      }
    } else if (row === KEYRING_ROW) {
      if (input === " " || key.return || key.leftArrow || key.rightArrow) {
        setKeyring((k) => !k);
        setTouched(true);
      }
    } else if (row === ACCESS_ROW) {
      if (input === " " || key.return || key.leftArrow || key.rightArrow) {
        setReadwrite((value) => !value);
      }
    } else if (key.return) {
      void submit(status.kind === "failed");
    }
  });

  const width = Math.max(1, Math.min(columns - 2, 76));
  const remote = !isLocalHost(values.host.trim());
  const busy = status.kind === "busy";

  return (
    <Box flexDirection="column" width={columns} height="100%">
      <Box flexGrow={1} justifyContent="center" alignItems="center">
        <Panel
          title={editing ? `Edit profile · ${editing}` : "New connection"}
          width={width}
          height={FIELDS.length + 11}
          focused
        >
          <Text dimColor>
            Saved to ~/.config/querypal/config.json (the password is never written there).
          </Text>
          <Text> </Text>

          {FIELDS.map((field, i) => {
            const focused = row === i;
            const value = values[field.key];
            const shown = field.key === "password" ? "*".repeat(value.length) : value;
            const placeholder = field.key === "password" && editing ? "(unchanged)" : field.hint;

            return (
              <Text key={field.key} wrap="truncate-end">
                <Text bold={focused} color={focused ? theme.accent : undefined}>
                  {(focused ? "› " : "  ") + field.label.padEnd(10)}
                </Text>
                <Text dimColor={editing !== undefined && i === 0}>{shown}</Text>
                {!shown && !focused && <Text dimColor>{placeholder}</Text>}
                {focused && <Text color={theme.accent}>█</Text>}
              </Text>
            );
          })}

          <Text> </Text>
          <Text wrap="truncate-end">
            <Text bold={row === KEYRING_ROW} color={row === KEYRING_ROW ? theme.accent : undefined}>
              {(row === KEYRING_ROW ? "› " : "  ") + (keyring ? "[x]" : "[ ]")} Save the password in
              the OS keyring
            </Text>
            {remote && (
              <Text color={keyring ? theme.error : undefined} dimColor={!keyring}>
                {keyring ? "  remote host: not recommended" : "  (remote: asked each time)"}
              </Text>
            )}
          </Text>
          <Text wrap="truncate-end">
            <Text bold={row === ACCESS_ROW} color={row === ACCESS_ROW ? theme.accent : undefined}>
              {(row === ACCESS_ROW ? "› " : "  ") + (readwrite ? "[x]" : "[ ]")} Allow writes for
              this profile
            </Text>
          </Text>
          <Text
            bold
            color={row === SAVE_ROW ? theme.selectedText : theme.accent}
            backgroundColor={row === SAVE_ROW ? theme.selectedBackground : undefined}
          >
            {`  ${status.kind === "failed" ? "[ Save anyway ]" : "[ Test & save ]"}  `}
          </Text>
          <Text
            wrap="truncate-end"
            color={
              status.kind === "busy" ? "yellow" : status.kind === "idle" ? undefined : theme.error
            }
          >
            {status.kind === "idle"
              ? " "
              : status.kind === "failed"
                ? `Connection failed: ${status.text}`
                : status.text}
          </Text>
          <Text dimColor wrap="truncate-end">
            {status.kind === "failed"
              ? "Enter on Save saves it anyway. Change a field to test again."
              : " "}
          </Text>
        </Panel>
      </Box>

      <StatusBar
        hints={
          busy
            ? [["…", "working"]]
            : [
                ["↑↓/tab", "field"],
                ["enter", row === SAVE_ROW ? "test & save" : "next"],
                ["space", "toggle"],
                ["esc", "cancel"],
              ]
        }
      />
    </Box>
  );
}
