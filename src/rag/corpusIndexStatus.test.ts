/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// Auditoría completa 2026-10-31 (F6-09): este módulo no tenía
// ninguna prueba. Es el estado que Ajustes enseña («indexando
// x / y»), así que su contrato importa: empieza en null (aún no
// comprobado), publicar fija el estado y avisa a los suscritos, y
// cancelar la suscripción deja de avisar.

import { describe, it, expect, vi } from "vitest";
import { getCorpusIndexStatus, onCorpusIndexStatus, publishStatus } from "./corpusIndexStatus";

describe("corpusIndexStatus (F6-09)", () => {
  it("publicar fija el estado, avisa a los suscritos y la baja deja de avisar", () => {
    const seen: unknown[] = [];
    const off = onCorpusIndexStatus((s) => seen.push(s));
    const s1 = { "corpus-full": { indexed: 3, total: 10 } };
    publishStatus(s1);
    expect(getCorpusIndexStatus()).toEqual(s1);
    expect(seen).toEqual([s1]);
    off();
    publishStatus({ "corpus-full": { indexed: 10, total: 10 } });
    expect(seen).toEqual([s1]);
    expect(getCorpusIndexStatus()).toEqual({ "corpus-full": { indexed: 10, total: 10 } });
  });

  it("varios suscriptores reciben lo mismo", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = onCorpusIndexStatus(a);
    const offB = onCorpusIndexStatus(b);
    publishStatus({});
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    offA();
    offB();
  });
});
