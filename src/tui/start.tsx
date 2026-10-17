import { render } from "ink";
import type { Connection } from "./connect.js";
import { Root, type Screen } from "./root.js";

const requireTerminal = () => {
  if (!process.stdin.isTTY) {
    throw new Error("The UI needs an interactive terminal.");
  }
};

// Takes over the whole terminal (alternate screen, like vim or htop) and restores it on exit.
// With no connection it opens on the profiles list (or the form, if asked), so one can be set up.
export async function startTui(connection: Connection | null, start: Screen = "browser"): Promise<void> {
  requireTerminal();

  await render(<Root initial={connection} start={start} />, { alternateScreen: true }).waitUntilExit();
}

// The connection form on its own: returns the saved profile, or null if cancelled.
export async function runSetupScreen(): Promise<{ name: string; connectionString: string } | null> {
  requireTerminal();

  let result: { name: string; connectionString: string } | null = null;

  await render(
    <Root
      initial={null}
      start="form"
      onSetupSaved={(saved) => {
        result = saved;
      }}
    />,
    { alternateScreen: true },
  ).waitUntilExit();

  return result;
}
