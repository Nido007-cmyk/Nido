// MIT License
// Copyright (c) 2026 NIDO contributors
// See LICENSE file for details.

import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { applyHideOverlaysToMainActivity, MARKER } = require("./withHideOverlays.js");

const KT = [
  "class MainActivity : ReactActivity() {",
  "  override fun onCreate(savedInstanceState: Bundle?) {",
  "    setTheme(R.style.AppTheme);",
  "    super.onCreate(null)",
  "    // NIDO P-F2 FLAG_SECURE — plugins/withFlagSecure.js",
  "    window.addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE)",
  "  }",
  "}",
].join("\n");

const JAVA = [
  "public class MainActivity extends ReactActivity {",
  "  @Override",
  "  protected void onCreate(Bundle savedInstanceState) {",
  "    super.onCreate(null);",
  "  }",
  "}",
].join("\n");

describe("withHideOverlays", () => {
  it("injects a guarded API 31+ call right after super.onCreate (Kotlin)", () => {
    const out = applyHideOverlaysToMainActivity(KT).split("\n");
    const i = out.findIndex((l) => l.includes("super.onCreate"));
    expect(out[i + 1]).toContain(MARKER);
    expect(out[i + 2]).toContain("SDK_INT >= 31");
    expect(out[i + 3]).toContain("try { window.setHideOverlayWindows(true) } catch (_: Exception) {}");
    // FLAG_SECURE sigue ahí, intacto.
    expect(out.join("\n")).toContain("window.addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE)");
  });

  it("0.1.51: on Android 11 and older, ignores touches while another app covers NIDO", () => {
    const out = applyHideOverlaysToMainActivity(KT).split("\n");
    const i = out.findIndex((l) => l.includes("super.onCreate"));
    expect(out[i + 4].trim()).toBe("} else {");
    expect(out[i + 5]).toContain("window.decorView.filterTouchesWhenObscured = true");
    expect(applyHideOverlaysToMainActivity(JAVA)).toContain("setFilterTouchesWhenObscured(true)");
  });

  it("injects the Java variant", () => {
    const out = applyHideOverlaysToMainActivity(JAVA);
    expect(out).toContain("getWindow().setHideOverlayWindows(true);");
    expect(out).toContain("catch (Exception ignored)");
  });

  it("is idempotent", () => {
    const once = applyHideOverlaysToMainActivity(KT);
    expect(applyHideOverlaysToMainActivity(once)).toBe(once);
  });

  it("fails the build loudly if the injection point is missing", () => {
    expect(() => applyHideOverlaysToMainActivity("class X {}")).toThrow(/super.onCreate/);
  });
});
