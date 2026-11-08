/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * guideLibraryImportGraph.test.ts — garantía estática del lector de
 * guías (verificación 2026-11-08): la cadena de imports que arranca en
 * GuideLibraryScreen NO alcanza ningún motor de inferencia.
 *
 * La prueba dinámica (GuideLibraryScreen.component.test.tsx y
 * App.component.test.tsx) espía llamaEngine.load/embeddingEngine.load
 * en tiempo de ejecución; esta es la ruta independiente: camina el
 * grafo de ficheros desde la pantalla (imports estáticos, `export …
 * from`, import() dinámicos y require() relativos; los imports de solo
 * tipos también se siguen, lo que hace la garantía más estricta que el
 * grafo real de ejecución) y comprueba que el cierre no contiene ni
 * los wrappers de motores ni el paquete nativo llama.rn, y que el
 * único fichero bajo src/inference/ alcanzado es nativeGate.ts, que
 * es una bandera sin imports. Si alguien cablea la pantalla al chat o
 * a la búsqueda semántica, esta prueba se pone roja aunque la dinámica
 * siga verde.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const SRC_ROOT = path.resolve(__dirname, "..");
const ENTRY = path.join(SRC_ROOT, "ui", "GuideLibraryScreen.tsx");

const SPEC_RES: RegExp[] = [
  /(?:import|export)[^"'\n]*?from\s*["']([^"']+)["']/g,
  /import\s*["']([^"']+)["']/g,
  /import\s*\(\s*["']([^"']+)["']\s*\)/g,
  /require\s*\(\s*["']([^"']+)["']\s*\)/g,
];

function resolveRelative(fromFile: string, spec: string): string | null {
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [
    base + ".ts",
    base + ".tsx",
    base + ".js",
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ];
  for (const c of candidates) {
    try {
      if (fs.statSync(c).isFile()) return c;
    } catch {
      /* siguiente candidato */
    }
  }
  return null;
}

function walk(entry: string): { files: Set<string>; externals: Set<string> } {
  const files = new Set<string>();
  const externals = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    const content = fs.readFileSync(file, "utf8");
    for (const re of SPEC_RES) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        const spec = m[1];
        if (spec.startsWith(".")) {
          const resolved = resolveRelative(file, spec);
          if (resolved && !files.has(resolved)) queue.push(resolved);
        } else {
          externals.add(spec);
        }
      }
    }
  }
  return { files, externals };
}

describe("GuideLibraryScreen · grafo de imports sin motores", () => {
  const { files, externals } = walk(ENTRY);
  const rel = [...files].map((f) => path.relative(SRC_ROOT, f));

  it("el caminante recorre de verdad la cadena (cordura)", () => {
    expect(files.has(ENTRY)).toBe(true);
    // La pantalla lee los packs por la API pública de packs.ts…
    expect(files.has(path.join(SRC_ROOT, "rag", "packs.ts"))).toBe(true);
    // …usa el tema de la casa…
    expect(rel.some((f) => f.startsWith(path.join("ui", "theme")))).toBe(true);
    // …y el cierre es una cadena real, no un fichero suelto.
    expect(files.size).toBeGreaterThan(10);
  });

  it("no alcanza los wrappers de motores ni el paquete llama.rn", () => {
    expect(files.has(path.join(SRC_ROOT, "inference", "LlamaEngine.ts"))).toBe(false);
    expect(files.has(path.join(SRC_ROOT, "rag", "embed.ts"))).toBe(false);
    expect(externals.has("llama.rn")).toBe(false);
    expect([...externals].some((s) => s.includes("llama"))).toBe(false);
  });

  it("bajo src/inference/ solo aparece nativeGate.ts, sin imports", () => {
    const underInference = rel.filter((f) => f.startsWith("inference" + path.sep));
    expect(underInference).toEqual([path.join("inference", "nativeGate.ts")]);
    const gate = fs.readFileSync(path.join(SRC_ROOT, "inference", "nativeGate.ts"), "utf8");
    expect(/from\s*["']/.test(gate)).toBe(false);
    expect(/require\s*\(/.test(gate)).toBe(false);
  });
});
