/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { ensureRuntimePermission, filterContacts } from "./contactSearch";
import {
  __resetPermissionGuardForTests,
  isPermissionFlowActive,
  isPermissionRequestInFlight,
} from "../../p2p/permissionGuard";

beforeEach(() => __resetPermissionGuardForTests());

describe("ensureRuntimePermission — causa raíz del lock screen", () => {
  it("permiso ya concedido → NO se llama a request (no se abre la actividad del sistema)", async () => {
    let requests = 0;
    const r = await ensureRuntimePermission({
      get: async () => ({ granted: true }),
      request: async () => {
        requests++;
        return { granted: true };
      },
    });
    expect(r).toEqual({ ok: true });
    expect(requests).toBe(0);
    // Ni siquiera se activa la bandera: no hubo diálogo.
    expect(isPermissionFlowActive()).toBe(false);
  });

  it("falta el permiso → la petición va dentro de la bandera que respeta App.tsx", async () => {
    let flagDuringRequest = false;
    const r = await ensureRuntimePermission({
      get: async () => ({ granted: false, canAskAgain: true }),
      request: async () => {
        flagDuringRequest = isPermissionRequestInFlight();
        return { granted: true };
      },
    });
    expect(r).toEqual({ ok: true });
    expect(flagDuringRequest).toBe(true);
    // Ventana de gracia tras cerrarse el diálogo (llega el "active").
    expect(isPermissionFlowActive()).toBe(true);
  });

  it("'no volver a preguntar' → no se abre nada y se explica cómo activarlo", async () => {
    let requests = 0;
    const r = await ensureRuntimePermission({
      get: async () => ({ granted: false, canAskAgain: false }),
      request: async () => {
        requests++;
        return { granted: false };
      },
    });
    expect(r).toEqual({ ok: false, reason: "blocked" });
    expect(requests).toBe(0);
  });

  it("el usuario deniega → 'denied'; si además lo bloquea → 'blocked'", async () => {
    expect(
      await ensureRuntimePermission({
        get: async () => ({ granted: false, canAskAgain: true }),
        request: async () => ({ granted: false, canAskAgain: true }),
      }),
    ).toEqual({ ok: false, reason: "denied" });
    expect(
      await ensureRuntimePermission({
        get: async () => ({ granted: false, canAskAgain: true }),
        request: async () => ({ granted: false, canAskAgain: false }),
      }),
    ).toEqual({ ok: false, reason: "blocked" });
  });

  it("el módulo nativo lanza → 'unavailable', nunca una excepción", async () => {
    const r = await ensureRuntimePermission({
      get: async () => {
        throw new Error("Not implemented");
      },
      request: async () => ({ granted: true }),
    });
    expect(r).toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("filterContacts — forma de la API nueva de expo-contacts (fullName, phones)", () => {
  const book = [
    { fullName: "Rubén Díaz", phones: [{ number: "+52 55 1234 5678" }, { number: "55 0000 1111" }] },
    { fullName: "Ana López", phones: [{ number: "555-111-2222" }] },
    { fullName: "Ana Ruiz", phones: [] },
    { fullName: null, phones: [{ number: "999" }] },
  ];

  it("ignora acentos y mayúsculas: 'ruben' encuentra 'Rubén'", () => {
    expect(filterContacts(book, "ruben")).toEqual([
      { name: "Rubén Díaz", phones: ["+52 55 1234 5678", "55 0000 1111"] },
    ]);
  });

  it("varias coincidencias, con y sin teléfono", () => {
    expect(filterContacts(book, "Ana").map((c) => c.name)).toEqual(["Ana López", "Ana Ruiz"]);
    expect(filterContacts(book, "Ana")[1].phones).toEqual([]);
  });

  it("busca por número solo si la consulta es un número (4+ dígitos)", () => {
    expect(filterContacts(book, "1112222").map((c) => c.name)).toEqual(["Ana López"]);
    expect(filterContacts(book, "12")).toEqual([]);
  });

  it("acepta también la forma antigua (name, phoneNumbers)", () => {
    expect(filterContacts([{ name: "Pedro", phoneNumbers: [{ number: "1" }] }], "ped")).toEqual([
      { name: "Pedro", phones: ["1"] },
    ]);
  });

  it("nunca devuelve más de 5 ni la agenda entera con consulta vacía", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ fullName: `Ana ${i}`, phones: [] }));
    expect(filterContacts(many, "ana")).toHaveLength(5);
    expect(filterContacts(many, "   ")).toEqual([]);
  });
});
