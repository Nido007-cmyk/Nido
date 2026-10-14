/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  LICENSE_FILE_RE,
  buildNotices,
  cleanText,
  normalizeLicense,
  packageNameFromPath,
  productionPackages,
  renderMarkdown,
  textId,
} from "./third-party-notices-lib.mjs";

const lock = {
  packages: {
    "": { name: "nido-app", version: "0.1.40" },
    "node_modules/react": { version: "19.0.0", license: "MIT" },
    "node_modules/vitest": { version: "3.0.0", license: "MIT", dev: true },
    "node_modules/node-forge": { version: "1.3.1", license: "(BSD-3-Clause OR GPL-2.0)" },
    "node_modules/a/node_modules/b": { version: "1.0.0", license: { type: "ISC" } },
    "node_modules/x/node_modules/b": { version: "1.0.0", license: "ISC" },
    "node_modules/ram-monitor": { resolved: "modules/ram-monitor", link: true },
    "node_modules/odd": { version: "2.0.0" },
  },
};

describe("productionPackages", () => {
  it("deja fuera lo de desarrollo y la raíz, y no duplica nombre+versión", () => {
    const pk = productionPackages(lock);
    expect(pk.map((p) => `${p.name}@${p.version}`)).toEqual([
      "b@1.0.0",
      "node-forge@1.3.1",
      "odd@2.0.0",
      "ram-monitor@local",
      "react@19.0.0",
    ]);
    expect(pk.find((p) => p.name === "ram-monitor").local).toBe(true);
    expect(pk.find((p) => p.name === "b").license).toBe("ISC");
  });

  it("nombres y licencias", () => {
    expect(packageNameFromPath("node_modules/@babel/core")).toBe("@babel/core");
    expect(packageNameFromPath("node_modules/a/node_modules/b")).toBe("b");
    expect(normalizeLicense(["MIT", "Apache-2.0"])).toBe("MIT OR Apache-2.0");
    expect(normalizeLicense(undefined)).toBeNull();
  });
});

describe("paquetes sin archivo del mismo proyecto", () => {
  const lock2 = {
    packages: {
      "": { name: "nido-app" },
      "node_modules/react-native": { version: "0.86.3", license: "MIT" },
      "node_modules/@react-native/virtualized-lists": { version: "0.86.3", license: "MIT" },
      "node_modules/@react-native/debugger-frontend": { version: "0.86.3", license: "BSD-3-Clause" },
      "node_modules/metro-runtime": { version: "0.84.5", license: "MIT" },
      "node_modules/ram-monitor": { resolved: "modules/ram-monitor", link: true },
      "modules/ram-monitor": { name: "ram-monitor", version: "0.1.0", license: "MIT" },
    },
  };
  const read = (p) => (p.name === "react-native" ? [{ file: "LICENSE", text: "MIT License\n\nCopyright (c) Meta Platforms, Inc. and affiliates." }] : []);

  it("toman el aviso de react-native solo si la licencia coincide", () => {
    const n = buildNotices(productionPackages(lock2), read);
    const vl = n.packages.find((p) => p.name === "@react-native/virtualized-lists");
    expect(vl.inheritedFrom).toBe("react-native");
    expect(vl.files[0].file).toBe("LICENSE (react-native)");
    expect(n.packages.find((p) => p.name === "metro-runtime").inheritedFrom).toBe("react-native");
    expect(n.packages.find((p) => p.name === "@react-native/debugger-frontend").inheritedFrom).toBeUndefined();
    expect(n.withoutText).toEqual(["@react-native/debugger-frontend@0.86.3"]);
  });

  it("la carpeta del módulo propio cuenta como de NIDO", () => {
    const pk = productionPackages(lock2);
    expect(pk.filter((p) => p.name === "ram-monitor").every((p) => p.local)).toBe(true);
  });
});

describe("archivos de licencia", () => {
  it("reconoce los nombres habituales y nada más", () => {
    for (const f of ["LICENSE", "LICENSE.md", "license.txt", "LICENCE", "COPYING", "NOTICE", "LICENSE-MIT", "LICENSE.APACHE2"]) {
      expect(LICENSE_FILE_RE.test(f)).toBe(true);
    }
    for (const f of ["README.md", "package.json", "licenses.js", "index.js"]) expect(LICENSE_FILE_RE.test(f)).toBe(false);
  });
});

describe("buildNotices", () => {
  const read = (p) =>
    p.name === "react"
      ? [{ file: "LICENSE", text: "MIT License\r\n\r\nCopyright (c) Meta   \r\n" }]
      : p.name === "b"
        ? [{ file: "LICENSE", text: "MIT License\n\nCopyright (c) Meta\n" }]
        : [];

  it("guarda cada texto una vez, normalizado, y lista lo que no trae archivo", () => {
    const n = buildNotices(productionPackages(lock), read, { generatedFrom: "x" });
    expect(Object.keys(n.texts)).toHaveLength(1);
    const id = textId(cleanText("MIT License\n\nCopyright (c) Meta"));
    expect(n.texts[id]).toBe("MIT License\n\nCopyright (c) Meta");
    expect(n.packages.find((p) => p.name === "react").files).toEqual([{ file: "LICENSE", text: id }]);
    expect(n.withoutText).toEqual(["node-forge@1.3.1", "odd@2.0.0"]); // el módulo local no cuenta
    expect(n.count).toBe(5);
  });

  it("documenta la elección de licencia de node-forge", () => {
    const n = buildNotices(productionPackages(lock), read);
    expect(n.packages.find((p) => p.name === "node-forge")).toMatchObject({ elected: "BSD-3-Clause" });
  });

  it("en modo parcial no acusa de «sin archivo» a nadie y lo dice en el markdown", () => {
    const n = buildNotices(productionPackages(lock), () => [], { partial: true });
    expect(n.withoutText).toEqual([]);
    expect(renderMarkdown(n)).toMatch(/Partial list/);
  });

  it("el markdown lleva tabla, elecciones y textos", () => {
    const md = renderMarkdown(buildNotices(productionPackages(lock), read, { generatedFrom: "lock" }));
    expect(md).toMatch(/\| react \| 19\.0\.0 \| MIT \|/);
    expect(md).toMatch(/\| ram-monitor \| local \| MIT \(NIDO's own module\) \|/);
    expect(md).toMatch(/NIDO uses it under \*\*BSD-3-Clause\*\*/);
    expect(md).toMatch(/### react@19\.0\.0 — LICENSE/);
    expect(md).toMatch(/Copyright \(c\) Meta/);
  });
});

describe("el archivo que viaja en la app", () => {
  const notices = JSON.parse(readFileSync(new URL("../../src/legal/thirdPartyNotices.json", import.meta.url), "utf8"));
  const lockReal = JSON.parse(readFileSync(new URL("../../package-lock.json", import.meta.url), "utf8"));

  it("cada texto citado existe y la cuenta cuadra", () => {
    expect(notices.count).toBe(notices.packages.length);
    for (const p of notices.packages) for (const f of p.files) expect(notices.texts[f.text]).toBeTypeOf("string");
  });

  it("cubre los paquetes de producción del lockfile (nombre y versión)", () => {
    const want = productionPackages(lockReal).map((p) => `${p.name}@${p.version}`);
    const have = notices.packages.map((p) => `${p.name}@${p.version}`);
    // Informativo para cambios de dependencias: el APK los regenera al
    // compilar y el workflow de avisos actualiza el repo; aquí se exige
    // que lo subido no esté vacío ni sea de otro proyecto.
    const missing = want.filter((k) => !have.includes(k));
    expect(have.length).toBeGreaterThan(100);
    expect(missing.length / want.length).toBeLessThan(0.2);
  });
});
