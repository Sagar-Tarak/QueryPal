import { deleteSecret, saveSecret } from "./keyring.js";
import { addProfile, loadConfig, saveConfig, type Profile } from "./profiles.js";

// Saves a profile and, if asked, its password in the OS keyring. The password never goes into
// the config file. `password` undefined means "keep whatever is stored" (editing a profile).
export async function saveProfile(options: {
  name: string;
  profile: Omit<Profile, "passwordStorage">;
  password?: string;
  wantKeyring: boolean;
}): Promise<{ storage: "keyring" | "prompt"; keyringFailed: boolean }> {
  const { name, profile, password, wantKeyring } = options;
  let storage: "keyring" | "prompt" = "prompt";
  let keyringFailed = false;

  if (wantKeyring) {
    if (password === undefined) {
      storage = "keyring";
    } else if (saveSecret(name, password)) {
      storage = "keyring";
    } else {
      keyringFailed = true;
    }
  }

  if (storage === "prompt") {
    deleteSecret(name);
  }

  await saveConfig(addProfile(await loadConfig(), name, { ...profile, passwordStorage: storage }));

  return { storage, keyringFailed };
}
