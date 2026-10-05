/**
 * withFlagSecure.test.js — P-F2 FLAG_SECURE (deterministic, no device).
 *
 * El plugin inyecta FLAG_SECURE en MainActivity.onCreate() vía el mod
 * `mainActivity` de @expo/config-plugins. Estos tests prueban:
 *  1. la transformación pura sobre fixtures Kotlin y Java;
 *  2. idempotencia (aplicar dos veces no duplica);
 *  3. byte-exactitud (quitando el bloque inyectado se recupera el input);
 *  4. que el plugin registra el mod correcto;
 *  5. fail-closed si no hay punto de inyección.
 */
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const withFlagSecure = require("./withFlagSecure.js");
const { applyFlagSecureToMainActivity } = withFlagSecure;

const KOTLIN_FIXTURE = `package team.nido.app

import android.os.Bundle
import com.facebook.react.ReactActivity

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(null)
  }

  override fun getMainComponentName(): String = "main"
}
`;

const JAVA_FIXTURE = `package team.nido.app;

import android.os.Bundle;
import com.facebook.react.ReactActivity;

public class MainActivity extends ReactActivity {
  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
  }
}
`;

function injectedBlock(indent, flagCall) {
  return `${indent}// NIDO P-F2 FLAG_SECURE — plugins/withFlagSecure.js\n${indent}${flagCall}`;
}

describe("applyFlagSecureToMainActivity", () => {
  it("injects FLAG_SECURE right after super.onCreate in Kotlin", () => {
    const out = applyFlagSecureToMainActivity(KOTLIN_FIXTURE);
    expect(out).toContain(
      injectedBlock(
        "    ",
        "window.addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE)"
      )
    );
    // Directly after super.onCreate(null):
    const lines = out.split("\n");
    const idx = lines.findIndex((l) => l.trim() === "super.onCreate(null)");
    expect(lines[idx + 1]).toMatch(/NIDO P-F2 FLAG_SECURE/);
    expect(lines[idx + 2]).toContain("FLAG_SECURE");
  });

  it("injects FLAG_SECURE in the Java template variant", () => {
    const out = applyFlagSecureToMainActivity(JAVA_FIXTURE);
    expect(out).toContain(
      "getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE);"
    );
    const lines = out.split("\n");
    const idx = lines.findIndex((l) =>
      l.trim().startsWith("super.onCreate(savedInstanceState);")
    );
    expect(lines[idx + 2]).toContain("FLAG_SECURE");
  });

  it("is idempotent — second application changes nothing", () => {
    const once = applyFlagSecureToMainActivity(KOTLIN_FIXTURE);
    const twice = applyFlagSecureToMainActivity(once);
    expect(twice).toBe(once);
    expect(once.match(/FLAG_SECURE/g).length).toBe(2); // marker + call
  });

  it("is byte-exact — removing the injected block restores the input", () => {
    const out = applyFlagSecureToMainActivity(KOTLIN_FIXTURE);
    const block = injectedBlock(
      "    ",
      "window.addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE)"
    );
    expect(out.replace(block + "\n", "")).toBe(KOTLIN_FIXTURE);
  });

  it("leaves an already-secured MainActivity untouched", () => {
    const secured =
      KOTLIN_FIXTURE +
      "\n// window.addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE)\n";
    expect(applyFlagSecureToMainActivity(secured)).toBe(secured);
  });

  it("fails closed when there is no super.onCreate injection point", () => {
    expect(() =>
      applyFlagSecureToMainActivity("class Foo {}\n")
    ).toThrow(/super\.onCreate/);
  });

  it("touches nothing else — no permissions, manifest or gradle content", () => {
    const out = applyFlagSecureToMainActivity(KOTLIN_FIXTURE);
    expect(out).not.toMatch(/uses-permission/i);
    expect(out).not.toMatch(/allowBackup|dataExtractionRules/i);
    expect(out).not.toMatch(/signingConfig/i);
  });
});

describe("withFlagSecure plugin wiring", () => {
  it("registers the android mainActivity mod", () => {
    const config = withFlagSecure({});
    expect(typeof config.mods.android.mainActivity).toBe("function");
  });

  it("the registered mod applies the transform to MainActivity contents", async () => {
    const config = withFlagSecure({});
    const modFn = config.mods.android.mainActivity;
    const modConfig = {
      modResults: { path: "MainActivity.kt", contents: KOTLIN_FIXTURE },
    };
    const result = await modFn(modConfig);
    expect(result.modResults.contents).toContain(
      "window.addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE)"
    );
  });
});
