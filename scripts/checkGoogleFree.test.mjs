// MIT License
// Copyright (c) 2026 NIDO contributors
// See LICENSE file for details.

/**
 * El juez del censo sin Google (scripts/check-google-free.py) probado con
 * APKs sintéticos: limpio, con restos en dex, con restos en el manifiesto
 * binario (UTF-16, como lo guarda AXML), con dependencias de Google, y sin
 * el árbol de dependencias pedido.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("./check-google-free.py", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "google-census-"));

// Un «APK» mínimo: un zip con classes*.dex y AndroidManifest.xml.
function apk(name, { dex = {}, manifest = [] }) {
  const path = join(dir, name);
  const spec = JSON.stringify({ dex, manifest });
  execFileSync(
    "python3",
    [
      "-c",
      `import json,sys,zipfile
s=json.loads(sys.argv[2])
with zipfile.ZipFile(sys.argv[1],"w") as z:
    for n,body in (s["dex"] or {"classes.dex":"dex\\n035 Lnido/App;"}).items():
        z.writestr(n, body.encode())
    z.writestr("AndroidManifest.xml", b"\\x03\\x00\\x08\\x00" + b"".join(x.encode("utf-16-le") for x in (s["manifest"] or ["team.nido.app"])))`,
      path,
      spec,
    ],
  );
  return path;
}

function run(args) {
  const r = spawnSync("python3", [SCRIPT, ...args], { encoding: "utf8" });
  return { code: r.status, out: r.stdout };
}

const cleanDeps = join(dir, "deps-clean.txt");
writeFileSync(cleanDeps, "+--- androidx.core:core:1.17.0\n+--- net.zetetic:sqlcipher-android:4.6.1\n");
const dirtyDeps = join(dir, "deps-dirty.txt");
writeFileSync(
  dirtyDeps,
  "|    +--- com.google.firebase:firebase-messaging:25.0.1\n|    +--- com.android.installreferrer:installreferrer:2.2\n",
);

describe("check-google-free.py", () => {
  it("un APK limpio con dependencias limpias sale 0 y lo dice", () => {
    const json = join(dir, "clean.json");
    const r = run([apk("clean.apk", {}), "--deps", cleanDeps, "--json", json]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("**Resultado:** limpio");
    expect(JSON.parse(readFileSync(json, "utf8"))).toMatchObject({ dex: {}, manifest: {}, dependencies: [], problems: [] });
  });

  it("restos en cualquier classesN.dex: cuenta por fichero y sale 1", () => {
    const r = run([
      apk("dex.apk", {
        dex: {
          "classes.dex": "Lcom/google/android/finsky/externalreferrer/IGetInstallReferrerService;",
          "classes2.dex": "Lcom/google/firebase/messaging/RemoteMessage; com/google/firebase/x",
        },
      }),
    ]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("dex: 2 referencias a com/google/firebase (classes2.dex 2)");
    expect(r.out).toContain("dex: 1 referencias a com/google/android/finsky (classes.dex 1)");
  });

  it("servicios datatransport CCT en el manifiesto binario (UTF-16): los nombra y sale 1", () => {
    const r = run([
      apk("manifest.apk", {
        manifest: ["com.google.android.datatransport.runtime.backends.TransportBackendDiscovery"],
      }),
    ]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/manifiesto: com\.google\.android\.datatransport \(1\): com\.google\.android\.datatransport\.runtime\.backends\.TransportBackendDiscovery/);
  });

  it("dependencias de Google en el árbol publicado: cada una es un hallazgo", () => {
    const r = run([apk("deps.apk", {}), "--deps", dirtyDeps]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("dependencia: com.google.firebase:firebase-messaging:25.0.1");
    expect(r.out).toContain("dependencia: com.android.installreferrer:installreferrer:2.2");
  });

  it("si falta el árbol de dependencias pedido, no cuenta como limpio", () => {
    const r = run([apk("nodeps.apk", {}), "--deps", join(dir, "no-existe.txt")]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("no está el árbol de dependencias");
  });
});
