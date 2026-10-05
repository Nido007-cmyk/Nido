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
