/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * R3 — Secure confirmation dialog (TypeScript wrapper).
 *
 * Shows the agent-confirmation / pairing-fingerprint dialog through the
 * native NidoSecureDialog module, which sets FLAG_SECURE on the dialog's
 * own Android window (the activity window's P-F2 flag does not cover
 * Dialog windows).
 *
 * Fail-closed: if the native module is missing or the call throws
 * (including on iOS/test environments), the promise resolves false —
 * the N2 contract for "confirmation unavailable".
 */
import { requireNativeModule } from "expo-modules-core";

export interface SecureAlertOptions {
  title: string;
  message: string;
  /** Defaults to the localized cancel label. */
  cancelLabel: string;
  /** Defaults to the localized confirm label. */
  confirmLabel: string;
  /** Defaults to true. */
  cancelable?: boolean;
}

interface NidoSecureDialogNativeModule {
  copySensitive?(text: string): Promise<boolean>;
  clearClipboardIfEquals?(text: string): Promise<boolean>;
  applyIncognitoKeyboard?(): Promise<number>;
  showSecureAlert(
    title: string,
    message: string,
    cancelLabel: string,
    confirmLabel: string,
    cancelable: boolean
  ): Promise<boolean>;
}

/**
 * Shows the secure confirmation dialog. Resolves true on explicit
 * confirm, false on cancel, dismiss, missing module, or any error.
 */
export async function showSecureAlert(
  options: SecureAlertOptions
): Promise<boolean> {
  try {
    const native =
      requireNativeModule<NidoSecureDialogNativeModule>("NidoSecureDialog");
    return await native.showSecureAlert(
      options.title,
      options.message,
      options.cancelLabel,
      options.confirmLabel,
      options.cancelable ?? true
    );
  } catch {
    // N2 fail-closed: confirmation unavailable → deny.
    return false;
  }
}

/**
 * 0.1.18: copies a secret marked as sensitive (hidden from clipboard previews
 * and keyboard history on Android 13+). false if the native function isn't
 * available (old build, tests): the caller then uses the normal clipboard.
 */
export async function copySensitive(text: string): Promise<boolean> {
  try {
    const native = requireNativeModule<NidoSecureDialogNativeModule>("NidoSecureDialog");
    if (!native.copySensitive) return false;
    return (await native.copySensitive(text)) === true;
  } catch {
    return false;
  }
}

/** 0.1.18: clears the clipboard if it still holds `text`. null = not available. */
export async function clearClipboardIfEquals(text: string): Promise<boolean | null> {
  try {
    const native = requireNativeModule<NidoSecureDialogNativeModule>("NidoSecureDialog");
    if (!native.clearClipboardIfEquals) return null;
    return (await native.clearClipboardIfEquals(text)) === true;
  } catch {
    return null;
  }
}

/**
 * 0.1.46: incognito keyboard. Asks the keyboard not to learn from the focused
 * text field (IME_FLAG_NO_PERSONALIZED_LEARNING). Call it from a TextInput's
 * onFocus. null = not available (old build, tests); never throws.
 */
export async function applyIncognitoKeyboard(): Promise<number | null> {
  try {
    const native = requireNativeModule<NidoSecureDialogNativeModule>("NidoSecureDialog");
    if (!native.applyIncognitoKeyboard) return null;
    return await native.applyIncognitoKeyboard();
  } catch {
    return null;
  }
}
