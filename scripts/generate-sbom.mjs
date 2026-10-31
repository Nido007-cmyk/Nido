/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * generate-sbom.mjs — SBOM CycloneDX de las dependencias de
 * producción, generado desde package-lock.json.
 *
 * Auditoría completa 2026-10-31 (F7-04): el paso de release usaba
 * «npm sbom --package-lock-only», cuya salida omite la mayor parte
 * del árbol (221 componentes frente a los 590 paquetes de
 * producción del lockfile) y deja fuera react y react-native, sin
 * que ninguna guarda lo notara; generar desde el árbol instalado
 * da el mismo resultado, porque el grafo que npm sbom recorre es
 * el mismo. La fuente completa y estable es el lockfile, con la
 * misma definición de «producción» que ya usan los avisos de
 * terceros (productionPackages): lo que el lockfile no marca dev,
 * sin duplicados de nombre y versión.
 *
 * Uso: node scripts/generate-sbom.mjs [ruta-salida]
 * Sin ruta, escribe en la salida estándar. Falla (exit 1) si el
 * conjunto no contiene react y react-native: son el canario de
 * que el grafo volvió a salir recortado.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { productionPackages } from "./lib/third-party-notices-lib.mjs";

const root = new URL("../", import.meta.url);
const lock = JSON.parse(readFileSync(new URL("package-lock.json", root), "utf8"));
const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));

function licenseField(license) {
  if (!license) return undefined;
  if (/^[A-Za-z0-9.+-]+$/.test(license)) return [{ license: { id: license } }];
  if (/\b(OR|AND)\b|[()]/.test(license)) return [{ expression: license }];
  return [{ license: { name: license } }];
}

function purlFor(name, version) {
  const encoded = name.startsWith("@")
    ? "%40" + name.slice(1).replace("/", "%2F")
    : name;
  return `pkg:npm/${encoded}@${version}`;
}

const components = productionPackages(lock).map((p) => {
  const c = {
    type: "library",
    "bom-ref": `pkg:npm/${p.name}@${p.version}`,
    name: p.name,
    version: p.version,
  };
  if (!p.local) c.purl = purlFor(p.name, p.version);
  const lic = licenseField(p.license);
  if (lic) c.licenses = lic;
  return c;
});

const names = new Set(components.map((c) => c.name));
for (const canary of ["react", "react-native"]) {
  if (!names.has(canary)) {
    console.error(`generate-sbom: FALTA ${canary} en el conjunto de producción; el SBOM saldría recortado (F7-04)`);
    process.exit(1);
  }
}

const sbom = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  metadata: {
    timestamp: new Date().toISOString(),
    tools: [{ vendor: "NIDO", name: "generate-sbom", version: "1" }],
    component: {
      type: "application",
      "bom-ref": `pkg:npm/${pkg.name}@${pkg.version}`,
      name: pkg.name,
      version: pkg.version,
    },
  },
  components,
};

const out = JSON.stringify(sbom, null, 2) + "\n";
const dest = process.argv[2];
if (dest) writeFileSync(dest, out);
else process.stdout.write(out);
console.error(`generate-sbom: ${components.length} componentes de producción`);
