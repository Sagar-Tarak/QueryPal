import { Box, Text, useInput, useWindowSize } from "ink";
import { useEffect, useState } from "react";
import { deleteSecret } from "../config/keyring.js";
import { lookupPassword } from "../config/password.js";
import {
  loadConfig,
  removeProfile,
  saveConfig,
  setDefault,
  type Config,
} from "../config/profiles.js";
import { explainError } from "../database/postgres/errors.js";
import { type Connection, openConnection } from "./connect.js";
import { editText } from "./edit-text.js";
import { Panel } from "./panel.js";
import { StatusBar } from "./status-bar.js";
import { theme } from "./theme.js";

// What the screen is waiting on besides the list: a password, a database name, or a yes/no.
type Ask =
  | { kind: "password"; name: string; then: (password: string) => void }
  | { kind: "database"; name: string }
  | { kind: "delete"; name: string };

export function ProfilesScreen(props: {
  connectedSource?: string;
  notice?: string;
  onConnect: (connection: Connection) => void;
  onAdd: () => void;
  onEdit: (name: string) => void;
  onBack: () => void;
  onQuit: () => void;
}) {
  const { columns, rows } = useWindowSize();
  const [config, setConfig] = useState<Config | null>(null);
  const [selected, setSelected] = useState(0);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState({ text: props.notice ?? "", error: false });

  const names = Object.keys(config?.profiles ?? {});
  const name = names[selected];
  const profile = name ? config?.profiles[name] : undefined;

  const reload = () => loadConfig().then(setConfig, (e) => setMessage({ text: explainError(e), error: true }));

  useEffect(() => {
    void reload();
  }, []);

  const fail = (e: unknown) => {
    setBusy("");
    setMessage({ text: explainError(e), error: true });
  };

  // The password comes from the keyring or QUERYPAL_PASSWORD; otherwise ask for it here.
  const withPassword = (then: (password: string) => void) => {
    if (!name || !profile) {
      return;
    }

    const found = lookupPassword(name, profile.passwordStorage);

    if (found !== null) {
      then(found);
    } else {
      setText("");
      setAsk({ kind: "password", name, then });
    }
  };

  const connect = async (password: string, database?: string) => {
    if (!name || !profile || !config) {
      return;
    }

    setBusy(`Connecting to ${name}…`);

    try {
      const connection = await openConnection(name, profile, password, database);

      await saveConfig(setDefault(config, name, database));
      props.onConnect(connection);
    } catch (e) {
      fail(e);
    }
  };

  const test = async (password: string) => {
    if (!name || !profile) {
      return;
    }

    setBusy(`Testing ${name}…`);

    try {
      const { pool, info } = await openConnection(name, profile, password);

      await pool.end();
      setBusy("");
      setMessage({
        text: `${name}: connected to "${info.database}" as ${info.user} · PostgreSQL ${info.version} · ${info.ms} ms`,
        error: false,
      });
    } catch (e) {
      fail(e);
    }
  };

  useInput((input, key) => {
    if (busy) {
      return;
    }

    if (ask) {
      if (ask.kind === "delete") {
        if (input === "y") {
          void (async () => {
            await saveConfig(removeProfile(config!, ask.name));
            deleteSecret(ask.name);
            setAsk(null);
            setSelected(0);
            setMessage({ text: `Removed profile "${ask.name}".`, error: false });
            await reload();
          })().catch(fail);
        } else if (input === "n" || key.escape) {
          setAsk(null);
        }

        return;
      }

      if (key.escape) {
        setAsk(null);
      } else if (key.return) {
        const value = text;

        setAsk(null);

        if (ask.kind === "password") {
          ask.then(value);
        } else if (value.trim()) {
          withPassword((password) => void connect(password, value.trim()));
        }
      } else {
        const next = editText(text, input, key);

        if (next !== null) {
          setText(next);
        }
      }

      return;
    }

    setMessage((m) => ({ ...m, text: "" }));

    if (input === "q") {
      props.onQuit();
    } else if (key.escape) {
      props.onBack();
    } else if (key.downArrow) {
      setSelected((s) => Math.min(s + 1, names.length - 1));
    } else if (key.upArrow) {
      setSelected((s) => Math.max(s - 1, 0));
    } else if (input === "a") {
      props.onAdd();
    } else if (!name) {
      return;
    } else if (key.return) {
      withPassword((password) => void connect(password));
    } else if (input === "t") {
      withPassword((password) => void test(password));
    } else if (input === "e") {
      props.onEdit(name);
    } else if (input === "x") {
      setAsk({ kind: "delete", name });
    } else if (input === "o") {
      setText("");
      setAsk({ kind: "database", name });
    }
  });

  const bodyHeight = Math.max(10, rows - 2);
  const leftWidth = Math.min(40, Math.max(26, Math.floor(columns * 0.35)));
  const rightWidth = Math.max(30, columns - leftWidth);
  const isDefault = name !== undefined && name === config?.defaultProfile;

  const detail = (label: string, value: string) => (
    <Text key={label} wrap="truncate-end">
      <Text color={theme.accent}>{label.padEnd(10)}</Text>
      {value}
    </Text>
  );

  const prompt =
    ask?.kind === "password"
      ? `password for ${ask.name}: ${"*".repeat(text.length)}`
      : ask?.kind === "database"
        ? `open which database on ${ask.name}'s server? ${text}`
        : ask?.kind === "delete"
          ? `Delete profile "${ask.name}" and its saved password? y/n`
          : undefined;

  return (
    <Box flexDirection="column" width={columns} height={rows - 1}>
      <Box height={bodyHeight}>
        <Panel title={`[1] Profiles ${names.length}`} width={leftWidth} height={bodyHeight} focused>
          {config && names.length === 0 && <Text dimColor>Press a to add a profile.</Text>}
          {names.map((n, i) => (
            <Text
              key={n}
              wrap="truncate-end"
              backgroundColor={i === selected ? theme.selectedBackground : undefined}
              color={i === selected ? theme.selectedText : undefined}
            >
              {`${n === config?.defaultProfile ? "* " : "  "}${n}`}
            </Text>
          ))}
        </Panel>

        <Panel title={name ? `[2] ${name}` : "[2] Details"} width={rightWidth} height={bodyHeight}>
          {profile && name ? (
            <>
              {detail("Host", `${profile.host}:${profile.port}`)}
              {detail("Database", isDefault && config?.defaultDatabase ? `${config.defaultDatabase} (saved override; profile says ${profile.database})` : profile.database)}
              {detail("User", profile.user)}
              {detail("Password", profile.passwordStorage === "keyring" ? "in the OS keyring" : "asked each time (or QUERYPAL_PASSWORD)")}
              {detail("Default", isDefault ? "yes" : "no")}
              {detail("Connected", props.connectedSource?.startsWith(`profile "${name}"`) ? "yes" : "no")}
            </>
          ) : (
            <Text dimColor>Select a profile to see its details.</Text>
          )}
          <Text> </Text>
          {busy ? <Text color="yellow">{busy}</Text> : null}
          {!busy && message.text ? (
            <Text color={message.error ? theme.error : theme.accent} wrap="wrap">
              {message.text}
            </Text>
          ) : null}
        </Panel>
      </Box>

      <StatusBar
        prompt={prompt}
        hints={[
          ["↑↓", "select"],
          ["enter", "connect"],
          ["a", "add"],
          ["e", "edit"],
          ["t", "test"],
          ["o", "other database"],
          ["x", "delete"],
          ["esc", "back"],
          ["q", "quit"],
        ]}
      />
    </Box>
  );
}
