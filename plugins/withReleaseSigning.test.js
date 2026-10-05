// MIT License
// Copyright (c) 2026 NIDO contributors
// See LICENSE file for details.

/**
 * withReleaseSigning.test.js — Fase 3 (NIDO release identity).
 *
 * The plugin injects a `release` signingConfig into android/app/build.gradle
 * driven by the NIDO_UPLOAD_* Gradle properties. These tests verify:
 *  1. the injected block and guard use the NIDO_UPLOAD_* names;
 *  2. no BOAR_UPLOAD_* residue remains anywhere in the transform;
 *  3. idempotency (second application is a no-op);
 *  4. the release buildType switches to the release config conditionally.
 */
import { describe, expect, it, beforeAll } from "vitest";
import { createRequire } from "node:module";
import Module from "node:module";

const require = createRequire(import.meta.url);

// Capture the withAppBuildGradle callback by intercepting the CJS require of
// @expo/config-plugins (the plugin is CommonJS).
let capturedModFn = null;
const fakeWithAppBuildGradle = (config, fn) => {
  capturedModFn = fn;
  return config;
};

let withReleaseSigning;
beforeAll(() => {
  const origLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === "@expo/config-plugins") {
      return { withAppBuildGradle: fakeWithAppBuildGradle };
    }
    return origLoad.call(this, request, parent, isMain);
  };
  try {
    withReleaseSigning = require("./withReleaseSigning.js");
  } finally {
    Module._load = origLoad;
  }
});

const GRADLE_FIXTURE = `android {
    signingConfigs {
    }
    buildTypes {
        release {
            // NIDO: release config injected by withReleaseSigning
            signingConfig signingConfigs.debug
        }
    }
}`;

function apply(contents) {
  const config = withReleaseSigning({});
  const out = capturedModFn({ modResults: { contents } });
  return out.modResults.contents;
}

describe("withReleaseSigning (NIDO identity)", () => {
  it("injects the release signingConfig block with NIDO_UPLOAD_* names", () => {
    const out = apply(GRADLE_FIXTURE);
    expect(out).toContain("if (project.hasProperty('NIDO_UPLOAD_STORE_FILE'))");
    expect(out).toContain("storeFile file(NIDO_UPLOAD_STORE_FILE)");
    expect(out).toContain("storePassword NIDO_UPLOAD_STORE_PASSWORD");
    expect(out).toContain("keyAlias NIDO_UPLOAD_KEY_ALIAS");
    expect(out).toContain("keyPassword NIDO_UPLOAD_KEY_PASSWORD");
  });

  it("leaves zero BOAR_UPLOAD_* residue in the transformed gradle", () => {
    const out = apply(GRADLE_FIXTURE);
    expect(out).not.toContain("BOAR_UPLOAD");
  });

  it("switches the release buildType to the conditional signingConfig", () => {
    const out = apply(GRADLE_FIXTURE);
    expect(out).toContain(
      "signingConfig project.hasProperty('NIDO_UPLOAD_STORE_FILE') ? signingConfigs.release : signingConfigs.debug"
    );
  });

  it("is idempotent — second application changes nothing", () => {
    const once = apply(GRADLE_FIXTURE);
    const twice = apply(once);
    expect(twice).toBe(once);
  });

  it("is a no-op when the block is already present (guard)", () => {
    const already = GRADLE_FIXTURE.replace(
      "signingConfigs {",
      "signingConfigs {\n        // NIDO_UPLOAD_STORE_FILE already here"
    );
    expect(apply(already)).toBe(already);
  });
});
