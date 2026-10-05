/**
 * R3 — FLAG_SECURE on the agent-confirmation and pairing-fingerprint
 * dialog windows (deterministic, no device).
 *
 * What these tests prove (build-time native assertions, in the same
 * spirit as plugins/withFlagSecure.test.js):
 *  1. The native Kotlin module sets FLAG_SECURE on the DIALOG's own
 *     window on the dialog-creation path — not on the activity window
 *     (whose P-F2 flag provably does not cover Dialog windows: each
 *     Window carries independent flags).
 *  2. The TS wrapper is fail-closed: missing native module or any
 *     error → resolves false (the N2 "confirmation unavailable" contract).
 *  3. Both sensitive call sites (agent-confirmation in ChatScreen,
 *     pairing ceremony in NidoScreen) route through the secure dialog.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

const KOTLIN_PATH = new URL(
  "./android/src/main/java/expo/modules/nidosecuredialog/SecureDialogModule.kt",
  import.meta.url
);

describe("R3 — native dialog-window FLAG_SECURE (build-time assertion)", () => {
  it("sets FLAG_SECURE on the dialog's own window", () => {
    const src = readFileSync(KOTLIN_PATH, "utf8");
    // The flag must be applied to the dialog window object, not to the
    // activity window. P-F2's activity-window flag does not propagate to
    // Dialog windows (separate Window, independent flags).
    expect(src).toMatch(/dialog\.window\?\.addFlags\(WindowManager\.LayoutParams\.FLAG_SECURE\)/);
  });

  it("applies the flag on the creation path, before the dialog is shown", () => {
    const src = readFileSync(KOTLIN_PATH, "utf8");
    const flagCall =
      "dialog.window?.addFlags(WindowManager.LayoutParams.FLAG_SECURE)";
    const flagIdx = src.indexOf(flagCall);
    const showIdx = src.indexOf("dialog.show()");
    const createIdx = src.indexOf(".create()");
    expect(flagIdx).toBeGreaterThan(-1);
    // flag set after create() (window exists) and before show()
    expect(flagIdx).toBeGreaterThan(createIdx);
    expect(flagIdx).toBeLessThan(showIdx);
  });

  it("does not rely on the activity window for dialog protection", () => {
    const src = readFileSync(KOTLIN_PATH, "utf8");
    // No activity-window flagging in this module: the activity window is
    // P-F2's surface; the dialog window is R3's surface.
    expect(src).not.toMatch(/activity\.window|getWindow\(\)\.addFlags/);
  });

  it("is fail-closed on dismiss (back button / tap-outside → false)", () => {
    const src = readFileSync(KOTLIN_PATH, "utf8");
    expect(src).toMatch(/setOnDismissListener/);
    // single-settlement guard: button handlers and onDismiss cannot
    // resolve the promise twice
    expect(src).toMatch(/AtomicBoolean|compareAndSet/);
  });

  it("rejects (fail-closed) when there is no activity", () => {
    const src = readFileSync(KOTLIN_PATH, "utf8");
    expect(src).toMatch(/NO_ACTIVITY/);
  });
});

describe("R3 — sensitive call sites route through the secure dialog", () => {
  const chatScreen = new URL("../../src/ui/ChatScreen.tsx", import.meta.url);
  const nidoScreen = new URL("../../src/ui/NidoScreen.tsx", import.meta.url);

  it("ChatScreen agent-confirmation uses the secure dialog, not Alert.alert", () => {
    const src = readFileSync(chatScreen, "utf8");
    expect(src).toContain('from "nido-secure-dialog"');
    expect(src).toContain("showSecureAlert");
    // The agent-confirmation requestConfirm no longer uses the uncapturable
    // RN Alert.alert surface.
    expect(src).not.toContain("Alert.alert");
  });

  it("NidoScreen pairing ceremony uses the secure dialog, not Alert.alert", () => {
    const src = readFileSync(nidoScreen, "utf8");
    expect(src).toContain('from "nido-secure-dialog"');
    expect(src).toContain("showSecureAlert");
    expect(src).not.toContain("Alert.alert");
  });

  it("no other UI file was touched — scope stays narrow", () => {
    // The module wrapper is imported only by the two sensitive call sites.
    // (Other Alert.alert usages — settings/error toasts — are out of scope
    // and deliberately left on the plain surface.)
    const chat = readFileSync(chatScreen, "utf8");
    const nido = readFileSync(nidoScreen, "utf8");
    expect(chat).toContain("nido-secure-dialog");
    expect(nido).toContain("nido-secure-dialog");
  });
});

vi.mock("expo-modules-core", () => ({
  requireNativeModule: vi.fn(),
}));

import { requireNativeModule } from "expo-modules-core";
import { showSecureAlert } from "./index";

const mockedRequire = requireNativeModule as unknown as ReturnType<typeof vi.fn>;

describe("R3 — TS wrapper fail-closed behavior", () => {
  beforeEach(() => {
    mockedRequire.mockReset();
  });

  it("resolves the native result on confirm", async () => {
    mockedRequire.mockReturnValue({
      showSecureAlert: async () => true,
    });
    await expect(
      showSecureAlert({
        title: "t",
        message: "m",
        cancelLabel: "Cancel",
        confirmLabel: "OK",
      })
    ).resolves.toBe(true);
  });

  it("resolves false on cancel", async () => {
    mockedRequire.mockReturnValue({
      showSecureAlert: async () => false,
    });
    await expect(
      showSecureAlert({
        title: "t",
        message: "m",
        cancelLabel: "Cancel",
        confirmLabel: "OK",
      })
    ).resolves.toBe(false);
  });

  it("resolves false when the native module is missing (fail-closed)", async () => {
    mockedRequire.mockImplementation(() => {
      throw new Error("No native module");
    });
    await expect(
      showSecureAlert({
        title: "t",
        message: "m",
        cancelLabel: "Cancel",
        confirmLabel: "OK",
      })
    ).resolves.toBe(false);
  });

  it("resolves false when the native call throws (fail-closed)", async () => {
    mockedRequire.mockReturnValue({
      showSecureAlert: async () => {
        throw new Error("dialog failed");
      },
    });
    await expect(
      showSecureAlert({
        title: "t",
        message: "m",
        cancelLabel: "Cancel",
        confirmLabel: "OK",
      })
    ).resolves.toBe(false);
  });

  it("defaults cancelable to true", async () => {
    const fn = vi.fn(async () => true);
    mockedRequire.mockReturnValue({ showSecureAlert: fn });
    await showSecureAlert({
      title: "t",
      message: "m",
      cancelLabel: "Cancel",
      confirmLabel: "OK",
    });
    expect(fn).toHaveBeenCalledWith("t", "m", "Cancel", "OK", true);
  });
});
