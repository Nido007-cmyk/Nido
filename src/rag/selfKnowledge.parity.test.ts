/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// 0.1.34 (prueba física, Tab A9+): «Explícame cómo funcionas sin internet.
// ¿Dónde se guardan mis datos y quién puede verlos?» respondía «no encontré
// información» — la forma inglesa casaba y la española no.
import { describe, expect, it } from "vitest";
import { classifyKnowledgeQuery } from "./selfKnowledge";

describe("autoconocimiento: misma pregunta en es/en/pt", () => {
  it.each([
    ["Explícame cómo funcionas sin internet. ¿Dónde se guardan mis datos y quién puede verlos?", "capabilities"],
    ["Explain how you work without internet. Where is my data stored and who can see it?", "capabilities"],
    ["Me explica como você funciona sem internet. Onde ficam meus dados e quem pode vê-los?", "capabilities"],
    ["Explícame cómo funcionas sin internet.", "capabilities"],
    ["¿Cómo funcionas?", "capabilities"],
    ["¿Dónde se guardan mis datos y quién puede verlos?", "advantages"],
    // Ejemplos «Privacidad total» del carrusel de la app.
    ["¿Qué significa que seas 100% offline? ¿Mis conversaciones salen de este dispositivo en algún momento?", "advantages"],
    ["What does it mean that you're 100% offline? Does my conversation ever leave this device?", "advantages"],
    ["O que significa ser 100% offline? Minha conversa sai deste dispositivo em algum momento?", "advantages"],
  ])("%s", (q, cat) => {
    expect(classifyKnowledgeQuery(q)).toBe(cat);
  });

  it.each(["como funciona la fotosíntesis", "cómo funcionas tú con los motores de coches eléctricos"])(
    "«%s» no es una pregunta sobre NIDO",
    (q) => {
      expect(classifyKnowledgeQuery(q)).toBeNull();
    },
  );
});
