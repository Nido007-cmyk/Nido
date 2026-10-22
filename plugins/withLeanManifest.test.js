// MIT License
// Copyright (c) 2026 NIDO contributors
// See LICENSE file for details.
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { applyLeanManifest, applyStableDevServerIp, REMOVED_COMPONENTS } = require("./withLeanManifest.js");

describe("withLeanManifest", () => {
  it("marca para quitar los componentes push de Firebase", () => {
    const m = applyLeanManifest({ application: [{ receiver: [{ $: { "android:name": "otro.Receiver" } }] }] });
    expect(m.$["xmlns:tools"]).toBe("http://schemas.android.com/tools");
    for (const [kind, name] of REMOVED_COMPONENTS) {
      const c = m.application[0][kind].find((x) => x.$["android:name"] === name);
      expect(c.$["tools:node"]).toBe("remove");
    }
    expect(m.application[0].receiver.find((x) => x.$["android:name"] === "otro.Receiver").$["tools:node"]).toBeUndefined();
  });

  it("fija la IP del servidor de desarrollo solo en release, una vez", () => {
    const gradle = `android {\n    buildTypes {\n        debug {\n            signingConfig signingConfigs.debug\n        }\n        release {\n            minifyEnabled false\n        }\n    }\n}\n`;
    const out = applyStableDevServerIp(gradle);
    expect(out).toMatch(/release \{\n\s+\/\/ NIDO: IP fija[^\n]*\n\s+resValue "string", "react_native_dev_server_ip", "localhost"/);
    expect(out.indexOf("react_native_dev_server_ip")).toBeGreaterThan(out.indexOf("release {"));
    expect(applyStableDevServerIp(out)).toBe(out);
  });

  it("falla en voz alta si la plantilla cambia", () => {
    expect(() => applyStableDevServerIp("android {}")).toThrow(/buildTypes/);
  });
});
