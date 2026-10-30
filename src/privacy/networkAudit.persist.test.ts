/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Auditoría 2026-10-29: el registro de red prometía sobrevivir a un
 * reinicio y solo vivía en memoria. Aquí se simula el reinicio: un almacén
 * que sobrevive y un registro nuevo encima.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  networkAudit,
  parseStoredEntry,
  type NetworkAuditEntry,
  type NetworkAuditStore,
} from "./networkAudit";

function memoryStore(): NetworkAuditStore & { rows: NetworkAuditEntry[] } {
  const rows: NetworkAuditEntry[] = [];
  return {
    rows,
    async append(e) {
      rows.push(JSON.parse(JSON.stringify(e)));
    },
    async loadBefore(before, limit) {
      return rows.filter((r) => r.ts < before).slice(-limit);
    },
    async clear() {
      rows.length = 0;
    },
  };
}

const dl = (endpoint: string) =>
  ({ kind: "download_complete", endpoint, assetId: "a", bytesExpected: 1, bytesReceived: 1 }) as const;

afterEach(() => networkAudit._resetForTests(memoryStore()));

describe("registro de red persistido", () => {
  it("lo registrado en una sesión aparece después de reiniciar", async () => {
    const store = memoryStore();
    networkAudit._resetForTests(store, "2026-01-01T00:00:00.000Z");
    networkAudit.log(dl("huggingface.co/a.gguf"));
    networkAudit.log(dl("github.com/b.sqlite"));
    await networkAudit.flush();
    expect(store.rows).toHaveLength(2);

    // «Reinicio»: memoria vacía, mismo almacén.
    networkAudit._resetForTests(store, "2999-01-01T00:00:00.000Z");
    expect(networkAudit.list()).toEqual([]);
    networkAudit.log(dl("raw.githubusercontent.com/c.json"));
    await networkAudit.hydrate();
    expect(networkAudit.list().map((e) => e.endpoint)).toEqual([
      "raw.githubusercontent.com/c.json",
      "github.com/b.sqlite",
      "huggingface.co/a.gguf",
    ]);
  });

  it("hydrate no duplica lo de esta sesión aunque ya esté guardado", async () => {
    const store = memoryStore();
    networkAudit._resetForTests(store);
    networkAudit.log(dl("huggingface.co/x.gguf"));
    await networkAudit.flush();
    await networkAudit.hydrate();
    await networkAudit.hydrate();
    expect(networkAudit.list()).toHaveLength(1);
  });

  it("clear borra también lo guardado", async () => {
    const store = memoryStore();
    networkAudit._resetForTests(store);
    networkAudit.log(dl("huggingface.co/x.gguf"));
    await networkAudit.clear();
    expect(store.rows).toEqual([]);
    expect(networkAudit.isPristine()).toBe(true);
  });

  it("un almacén roto no rompe la operación registrada", async () => {
    const broken: NetworkAuditStore = {
      append: async () => {
        throw new Error("no db");
      },
      loadBefore: async () => {
        throw new Error("no db");
      },
      clear: async () => {
        throw new Error("no db");
      },
    };
    networkAudit._resetForTests(broken);
    expect(() => networkAudit.log(dl("huggingface.co/x.gguf"))).not.toThrow();
    await networkAudit.flush();
    await networkAudit.hydrate();
    expect(networkAudit.list()).toHaveLength(1);
  });

  it("avisa a la pantalla cuando llegan entradas antiguas", async () => {
    const store = memoryStore();
    store.rows.push({ ts: "2000-01-01T00:00:00.000Z", ...dl("github.com/old.sqlite") });
    networkAudit._resetForTests(store);
    let calls = 0;
    networkAudit.onEntry(() => calls++);
    await networkAudit.hydrate();
    expect(calls).toBe(1);
    expect(networkAudit.list()[0].endpoint).toBe("github.com/old.sqlite");
  });

  it("borrar todos los datos: nada pendiente acaba en la base nueva", async () => {
    const store = memoryStore();
    networkAudit._resetForTests(store);
    networkAudit.log(dl("huggingface.co/antes.gguf"));
    await networkAudit.flush();
    networkAudit.beginWipe();
    expect(networkAudit.list()).toEqual([]);
    // Una descarga cancelada durante el borrado se registra, pero no se guarda.
    networkAudit.log(dl("huggingface.co/durante.gguf"));
    store.rows.length = 0; // la base se borra
    await networkAudit.flush();
    expect(store.rows).toEqual([]);
    networkAudit.endWipe();
    expect(networkAudit.list()).toEqual([]);
    networkAudit.log(dl("github.com/despues.sqlite"));
    await networkAudit.flush();
    expect(store.rows.map((r) => r.endpoint)).toEqual(["github.com/despues.sqlite"]);
  });

  it("una fila con otra forma no se muestra", () => {
    expect(parseStoredEntry("no json")).toBeNull();
    expect(parseStoredEntry(JSON.stringify({ ts: "x", kind: "otro", endpoint: "e" }))).toBeNull();
    expect(parseStoredEntry(JSON.stringify({ ts: "x", kind: "lan_connect", endpoint: "192.168.1.2 in" }))).toMatchObject({
      kind: "lan_connect",
      assetId: "",
      bytesExpected: 0,
    });
  });
});
