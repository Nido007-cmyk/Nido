/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */
// 0.1.118: toda pulsación de la app usa el Pressable con respuesta al toque
// (src/ui/components/Pressable.tsx). Esta guarda impide que vuelva a entrar
// un Pressable de react-native sin ella.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.tsx$/.test(name) && !/\.test\.tsx$/.test(name)) out.push(p);
  }
  return out;
}

describe("guarda: Pressable con respuesta al toque", () => {
  it("ningún archivo importa Pressable directamente de react-native", () => {
    const offenders = [...files("src"), "App.tsx"].filter((f) => {
      if (f.endsWith(join("components", "Pressable.tsx"))) return false;
      const src = readFileSync(f, "utf8");
      return /import\s*(type\s*)?\{[^}]*\bPressable\b[^}]*\}\s*from\s*"react-native"/.test(src);
    });
    expect(offenders).toEqual([]);
  });
});
