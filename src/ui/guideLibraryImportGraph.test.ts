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
 *
 * Extensión RED TEAM 2026-11-08 (Frente 5): la misma prueba sella también
 * la segunda mitad de la promesa, «ni red». El cierre no puede nombrar
 * ningún cliente de red conocido (externos) ni alcanzar el único módulo
 * de la app que inicia red (models/ModelManager.ts, el punto auditado de
 * src/privacy/networkAudit.ts), y ningún fichero del cierre usa los
 * globales de red (fetch, WebSocket, XMLHttpRequest). El red team lo
 * había comprobado por enumeración manual; aquí queda como aserción
 * permanente que se pone roja si mañana alguien mete un cliente de red
 * en la cadena del lector.
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

/**
 * Clientes de red que NINGÚN import del cierre puede traer. El conjunto
 * sale del código de la casa (RED TEAM 2026-11-08): package.json no
 * declara axios ni expo-network y el único inicio de red de la app es el
 * global fetch dentro de ModelManager; la lista cubre esos nombres y los
 * clientes que un cambio futuro podría importar. Los especificadores se
 * normalizan a nombre de paquete (sin subrutas) antes de comparar.
 * expo-file-system NO está aquí: el lector lo usa en local
 * (expo-file-system/legacy) y este mismo fichero lo vigila en sentido
 * contrario, porque su superficie remota (createDownloadResumable) es la
 * única vía de red que podría colarse por un módulo ya presente.
 */
const NETWORK_CLIENT_EXTERNALS = new Set([
  "axios",
  "node-fetch",
  "undici",
  "ws",
  "socket.io-client",
  "@microsoft/fetch-event-source",
  "expo-network",
]);

function packageNameOf(spec: string): string {
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
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

  it("sin clientes de red en el cierre (RED TEAM 2026-11-08)", () => {
    // Cordura: el vigilante ve los externos REALES del lector (si el
    // caminante dejara de recoger especificadores, esta aserción y la de
    // red fallarían juntas en vez de pasar en falso).
    expect(externals.has("expo-file-system/legacy")).toBe(true);
    expect(externals.has("expo-sqlite")).toBe(true);
    // Tres vías por las que la red podría entrar en el cierre:
    // (a) un import de un cliente de red conocido (los especificadores se
    //     recogen sin las cadenas largas de SQL, que el caminante ya
    //     captura como «externos» falsos);
    // (b) una LLAMADA a un global de red (fetch(, new WebSocket, new
    //     XMLHttpRequest): la forma de llamada es la señal, porque el
    //     nombre suelto aparece en prosa inofensiva de estos módulos;
    // (c) la superficie remota de expo-file-system (createDownloadResumable
    //     y sus compañeros de descarga/subida), el único módulo presente
    //     en el cierre que también sabe hablar con la red.
    const named = new Set<string>();
    const hits: string[] = [];
    for (const file of files) {
      const content = fs.readFileSync(file, "utf8");
      for (const re of SPEC_RES) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(content)) !== null) {
          if (!m[1].startsWith(".") && !/\s/.test(m[1])) named.add(packageNameOf(m[1]));
        }
      }
      const relFile = path.relative(SRC_ROOT, file);
      if (/(?<![\w$.])fetch\s*\(/.test(content)) hits.push(`${relFile} llama a fetch(`);
      if (/new\s+(WebSocket|XMLHttpRequest)\b/.test(content)) hits.push(`${relFile} construye un cliente de red`);
      if (/\b(createDownloadResumable|downloadAsync|uploadAsync)\s*\(/.test(content)) {
        hits.push(`${relFile} usa la superficie remota de expo-file-system`);
      }
    }
    expect([...named].filter((n) => NETWORK_CLIENT_EXTERNALS.has(n))).toEqual([]);
    expect(hits).toEqual([]);
    // Y el único módulo de la app que inicia red queda fuera del cierre:
    // si el lector alcanzara ModelManager, alcanzaría la descarga.
    expect(files.has(path.join(SRC_ROOT, "models", "ModelManager.ts"))).toBe(false);
  });
});
