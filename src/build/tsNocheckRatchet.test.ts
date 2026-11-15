/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * tsNocheckRatchet.test.ts — trinquete de P-41 (0.1.99, T-17).
 *
 * Hasta la 0.1.98, 25 ficheros de test llevaban la directiva que
 * apaga el chequeo de tipos de todo el fichero (y el nuevo
 * NidoScreen.component.test.tsx nació con ella: 26). La tanda T-17
 * los limpió todos: los tres unitarios (installNotice,
 * contextReserveFit, noSourcesOutcome) y los 23 de componente,
 * cuyos errores eran en su inmensa mayoría la ausencia de tipos
 * de Jest — curada importando los globales desde "@jest/globals",
 * que es la vía tipada, sin tocar tsconfig ni dependencias.
 *
 * Este test fija el suelo: ningún fichero de src/ puede volver a
 * llevar la directiva. La cadena se construye partida a propósito:
 * si apareciera literal en este fichero, el propio trinquete se
 * contaría a sí mismo.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const SRC_ROOT = path.resolve(__dirname, "..");
const DIRECTIVE = "// @ts-" + "nocheck";

function collectSourceFiles(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(full, out);
    } else if (
      entry.isFile() &&
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))
    ) {
      out.push(full);
    }
  }
}

describe("trinquete @ts-nocheck (P-41)", () => {
  it("ningún fichero de src/ lleva la directiva que apaga el chequeo de tipos", () => {
    const files: string[] = [];
    collectSourceFiles(SRC_ROOT, files);
    const offenders = files.filter((f) =>
      fs
        .readFileSync(f, "utf8")
        .split("\n")
        .some((line) => line.trim() === DIRECTIVE),
    );
    expect(
      offenders.map((f) => path.relative(SRC_ROOT, f)),
    ).toEqual([]);
  });
});
