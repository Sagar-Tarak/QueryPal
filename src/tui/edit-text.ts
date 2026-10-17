import type { Key } from "ink";

// The text after a key press, or null when the key is not text editing (arrows, enter, tab...).
export function editText(text: string, input: string, key: Key): string | null {
  if (key.backspace || key.delete) {
    return text.slice(0, -1);
  }

  if (input && !key.ctrl && !key.meta && !key.return && !key.escape && !key.tab) {
    return text + input;
  }

  return null;
}
