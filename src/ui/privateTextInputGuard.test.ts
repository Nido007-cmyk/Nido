/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Guardia SEC-01 (auditoría de seguridad 2026-11-01): ningún campo de texto
 * libre puede nacer con el TextInput crudo de react-native. El de la casa es
 * PrivateTextInput, que pide el teclado incógnito (sin aprendizaje
 * personalizado) al recibir el foco. El único fichero autorizado a importar
 * TextInput como valor desde "react-native" es el propio PrivateTextInput:
 * cualquier otro es un campo que el teclado puede usar para aprender de lo
 * que la persona escribe — en Emergencias, el texto más sensible de la app.
 *
 * Paseo de fuentes modelado sobre src/i18n/hygiene.test.ts.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, sep } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..", "..");
const ALLOWED = join("src", "ui", "components", "PrivateTextInput.tsx");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    if (!/\.tsx?$/.test(name) || /\.test\.|\.d\.ts$/.test(name) || name.includes("__probe")) return [];
    return [full];
  });
}

const FILES = sourceFiles(join(ROOT, "src"));

/**
 * ¿Importa este fuente `TextInput` como VALOR desde "react-native"?
 * Los imports `import type { … }` y las entradas `type TextInput` no cuentan:
 * no traen el componente, solo el tipo.
 */
function importsRawTextInput(src: string): boolean {
  for (const m of src.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s*from\s*["']react-native["']/g)) {
    if (m[1]) continue; // import type { … }: solo tipos
    for (const entry of m[2].split(",")) {
      const e = entry.trim();
      if (e.startsWith("type ")) continue;
      if (/^TextInput(\s+as\s+\w+)?$/.test(e)) return true;
    }
  }
  return false;
}

describe("SEC-01 guard: no raw TextInput outside PrivateTextInput", () => {
  it("only PrivateTextInput.tsx imports TextInput as a value from react-native", () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      const rel = file.slice(ROOT.length + 1).split(sep).join("/");
      if (rel === ALLOWED.split(sep).join("/")) continue;
      if (importsRawTextInput(readFileSync(file, "utf8"))) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it("EmergencyScreen uses the house alias for its free-text field", () => {
    const src = readFileSync(join(ROOT, "src", "ui", "EmergencyScreen.tsx"), "utf8");
    expect(src).toContain("PrivateTextInput as TextInput");
  });
});
