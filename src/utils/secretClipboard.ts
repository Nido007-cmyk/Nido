/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Copying a secret (the backup key) — offensive audit, 0.1.18.
 *
 * Before: a plain clipboard write. The key stayed on the clipboard forever,
 * showed in the keyboard's suggestion strip and was saved in clipboard
 * history (Gboard, Samsung), where any app or person with the phone could
 * find it later. Now: copied as sensitive (native, Android 13+ hides it) and
 * removed after SECRET_CLIPBOARD_TTL_MS if it's still there — also when NIDO
 * comes back to the foreground after that time (timers don't run in the
 * background).
 */

export const SECRET_CLIPBOARD_TTL_MS = 60_000;

export interface SecretClipboardDeps {
  copySensitive: (text: string) => Promise<boolean>;
  clearIfEquals: (text: string) => Promise<boolean | null>;
  copyPlain: (text: string) => Promise<void>;
  readPlain: () => Promise<string>;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  onForeground: (fn: () => void) => () => void;
}

let pending: { text: string; until: number; stop: () => void } | null = null;

async function clearNow(deps: SecretClipboardDeps, text: string): Promise<void> {
  const native = await deps.clearIfEquals(text).catch(() => null);
  if (native !== null) return;
  try {
    if ((await deps.readPlain()) === text) await deps.copyPlain("");
  } catch {
    // Best-effort: nothing else to do.
  }
}

export async function copySecretWith(deps: SecretClipboardDeps, text: string): Promise<void> {
  if (!(await deps.copySensitive(text).catch(() => false))) await deps.copyPlain(text);
  pending?.stop();
  const until = deps.now() + SECRET_CLIPBOARD_TTL_MS;
  let stopForeground: () => void = () => {};
  const finish = () => {
    if (!pending || pending.text !== text) return;
    if (deps.now() < until) return;
    pending.stop();
    pending = null;
    void clearNow(deps, text);
  };
  stopForeground = deps.onForeground(finish);
  pending = { text, until, stop: () => stopForeground() };
  deps.setTimer(finish, SECRET_CLIPBOARD_TTL_MS + 50);
}

/** Test hook. */
export function _resetSecretClipboard(): void {
  pending?.stop();
  pending = null;
}

/** Copies `text` as a secret using the real clipboard, native module and AppState. */
export async function copySecret(text: string): Promise<void> {
  const Clipboard = await import("expo-clipboard");
  const { AppState } = await import("react-native");
  const secure = await import("nido-secure-dialog");
  return copySecretWith(
    {
      copySensitive: secure.copySensitive,
      clearIfEquals: secure.clearClipboardIfEquals,
      copyPlain: async (t) => {
        await Clipboard.setStringAsync(t);
      },
      readPlain: () => Clipboard.getStringAsync(),
      now: () => Date.now(),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      onForeground: (fn) => {
        const sub = AppState.addEventListener("change", (s) => {
          if (s === "active") fn();
        });
        return () => sub.remove();
      },
    },
    text,
  );
}
