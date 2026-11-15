/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * T-17 (0.1.99) · P-40: la pantalla dev (PoC V42) no viaja en el
 * bundle de release.
 *
 * App.tsx la importaba estáticamente: aunque su render vive tras
 * __DEV__, el import metía el módulo (y assets/poc/) en el grafo
 * de Metro del release. La cura la carga de forma diferida dentro
 * de la propia rama __DEV__. V42 está CONGELADO: no se itera su
 * contenido, solo se mueve su carga; la ruta dev debe seguir
 * abriendo igual en desarrollo.
 *
 * Sonda estructural: App.tsx sin import estático de ui/dev, con la
 * carga diferida presente y la puerta __DEV__ intacta en el render.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const APP = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");

describe("P-40 · la pantalla dev fuera del grafo estático", () => {
  it("App.tsx no importa estáticamente nada de ui/dev", () => {
    expect(APP).not.toMatch(/import[^;]*from\s*["']\.\/src\/ui\/dev\//);
    expect(APP).not.toContain('import { CharacterPreviewScreen }');
  });

  it("la carga es diferida (require dentro de la rama dev) y la puerta __DEV__ sigue en el render", () => {
    expect(APP).toContain('require("./src/ui/dev/CharacterPreviewScreen")');
    expect(APP).toMatch(/__DEV__ && devPreview/);
    expect(APP).toMatch(/__DEV__ && !devPreview && screen === "chat"/);
  });

  it("en producción, Metro resuelve ui/dev a un módulo vacío (el real no entra en el grafo)", () => {
    // Medido en la tanda: el require diferido solo NO basta — Metro
    // sigue los require estáticamente y el módulo viajaba igual en
    // el bundle de release (las cadenas del PoC aparecían en el
    // .hbc). La redirección del resolvedor es lo que lo deja fuera,
    // y va gateada a producción para no tocar la ruta dev.
    const metro = readFileSync(new URL("../../metro.config.js", import.meta.url), "utf8");
    expect(metro).toContain('process.env.NODE_ENV === "production"');
    expect(metro).toContain("resolveRequest");
    expect(metro).toContain("metro.empty-module.js");
  });
});
