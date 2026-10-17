import { password } from "@inquirer/prompts";
import { readSecret } from "./keyring.js";

// Prompts go to stderr so `querypal tables | jq` stays clean.
export const promptContext = { output: process.stderr };

// OS keyring (only if the profile opted in), then the env variable. Never prompts,
// so a full-screen UI can ask for the password itself.
export function lookupPassword(
  profileName: string,
  storage?: "keyring" | "prompt",
): string | null {
  const saved = storage === "keyring" ? readSecret(profileName) : null;

  return saved ?? process.env.QUERYPAL_PASSWORD ?? null;
}

// Order: OS keyring (only if the profile opted in), env variable, hidden prompt.
export async function getPassword(
  profileName: string,
  storage?: "keyring" | "prompt",
): Promise<string> {
  const found = lookupPassword(profileName, storage);

  if (found !== null) {
    return found;
  }

  if (!process.stdin.isTTY) {
    throw new Error("No password available. Set QUERYPAL_PASSWORD.");
  }

  return password(
    { message: `Password for profile "${profileName}":`, mask: "*" },
    promptContext,
  );
}
