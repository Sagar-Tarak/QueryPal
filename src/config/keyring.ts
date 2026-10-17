import { Entry } from "@napi-rs/keyring";

const SERVICE = "querypal";

// Thin wrapper so the keyring stays swappable. A missing or locked keyring never throws.
export function saveSecret(profileName: string, secret: string): boolean {
  try {
    new Entry(SERVICE, profileName).setPassword(secret);
    return true;
  } catch {
    return false;
  }
}

export function readSecret(profileName: string): string | null {
  try {
    return new Entry(SERVICE, profileName).getPassword();
  } catch {
    return null;
  }
}

export function deleteSecret(profileName: string): void {
  try {
    new Entry(SERVICE, profileName).deleteCredential();
  } catch {
    // nothing saved, or no keyring: nothing to clean up
  }
}
