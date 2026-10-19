import { Box, useApp, useWindowSize } from "ink";
import type { Pool } from "pg";
import { useEffect, useRef, useState } from "react";
import { buildConnectionString, loadConfig, type Config } from "../config/profiles.js";
import { App } from "./app.js";
import type { Connection } from "./connect.js";
import { FormScreen, type SavedProfile } from "./form-screen.js";
import { ProfilesScreen } from "./profiles-screen.js";

export type Screen = "browser" | "profiles" | "form";

// Switches between the data browser, the profiles list and the connection form.
// With `onSetupSaved` it is a one-shot setup: the form saves a profile, reports it, and the UI closes.
export function Root(props: {
  initial: Connection | null;
  start: Screen;
  onSetupSaved?: (saved: {
    name: string;
    connectionString: string;
    accessLevel: "read" | "readwrite";
  }) => void;
}) {
  const { exit } = useApp();
  const { rows } = useWindowSize();
  const [connection, setConnection] = useState(props.initial);
  const [screen, setScreen] = useState<Screen>(
    connection ? props.start : props.start === "browser" ? "profiles" : props.start,
  );
  const [editing, setEditing] = useState<string | undefined>();
  const [config, setConfig] = useState<Config>({ profiles: {} });
  const [notice, setNotice] = useState("");
  // Pools opened here are closed here. The initial one belongs to the caller, who closes it.
  const owned = useRef<Pool[]>([]);

  useEffect(() => {
    return () => {
      for (const pool of owned.current) {
        void pool.end();
      }
    };
  }, []);

  const openForm = async (name?: string) => {
    setConfig(await loadConfig());
    setEditing(name);
    setScreen("form");
  };

  const switchTo = (next: Connection) => {
    const old = connection?.pool;

    owned.current.push(next.pool);
    setConnection(next);
    setScreen("browser");

    if (old && owned.current.includes(old)) {
      owned.current = owned.current.filter((p) => p !== old);
      void old.end();
    }
  };

  const saved = (result: SavedProfile) => {
    if (props.onSetupSaved) {
      props.onSetupSaved({
        name: result.name,
        connectionString: buildConnectionString(result.profile, result.password),
        accessLevel: result.profile.accessLevel ?? "read",
      });
      exit();
      return;
    }

    setNotice(
      `Saved profile "${result.name}".${result.keyringFailed ? " The OS keyring is unavailable, so the password will be asked each time." : ""}`,
    );
    setScreen("profiles");
  };

  return (
    <Box flexDirection="column" height={rows - 1}>
      {screen === "browser" && connection ? (
        <App
          key={connection.source}
          pool={connection.pool}
          source={connection.source}
          accessLevel={connection.accessLevel}
          onProfiles={() => {
            setNotice("");
            setScreen("profiles");
          }}
        />
      ) : screen === "form" ? (
        <FormScreen
          config={config}
          editing={editing}
          onCancel={() => (props.onSetupSaved ? exit() : setScreen("profiles"))}
          onSaved={saved}
        />
      ) : (
        <ProfilesScreen
          key={notice}
          connectedSource={connection?.source}
          notice={notice}
          onConnect={switchTo}
          onAdd={() => void openForm()}
          onEdit={(name) => void openForm(name)}
          onBack={() => (connection ? setScreen("browser") : exit())}
          onQuit={exit}
        />
      )}
    </Box>
  );
}
