/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * TOOLS-AUDIT 2026-10-11 — handlers reales con los módulos nativos simulados:
 *  - find_contact usa la API multiplataforma (Contact.getAllDetails), no
 *    Container.getDefault (solo iOS: en Android lanzaba "Not implemented");
 *  - con el permiso ya concedido NO se llama a request* (en Android abre la
 *    actividad de permisos aunque esté concedido → NIDO pasaba a
 *    "background" → lock screen en cada búsqueda);
 *  - la petición real y el selector de archivos van dentro de la bandera
 *    de permisos que App.tsx respeta.
 */

vi.hoisted(() => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
});

const state = vi.hoisted(() => ({
  contactsGranted: true,
  contactsCanAskAgain: true,
  contactsRequests: 0,
  getAllDetailsCalls: [] as Array<{ fields: string[]; options: unknown }>,
  book: [] as Array<{ fullName: string; phones: Array<{ number: string }> }>,
  nativeFilterIsAccentSensitive: true,
  calendarGranted: true,
  calendarRequests: 0,
  flagSeenInRequest: false,
  flagSeenInPicker: false,
}));

vi.mock("expo-contacts", async () => {
  const guard = await import("../../p2p/permissionGuard");
  return {
    getPermissionsAsync: async () => ({ granted: state.contactsGranted, canAskAgain: state.contactsCanAskAgain }),
    requestPermissionsAsync: async () => {
      state.contactsRequests++;
      state.flagSeenInRequest = guard.isPermissionRequestInFlight();
      state.contactsGranted = true;
      return { granted: true, canAskAgain: true };
    },
    // Container existe solo en iOS: si alguien lo vuelve a usar, el test falla.
    Container: {
      getDefault: async () => {
        throw new Error("Not implemented");
      },
    },
    Contact: {
      getAllDetails: async (fields: string[], options?: { name?: string }) => {
        state.getAllDetailsCalls.push({ fields, options });
        const name = options?.name;
        if (!name) return state.book;
        // El filtro nativo distingue acentos (LIKE de SQLite).
        return state.book.filter((c) => c.fullName.toLowerCase().includes(name.toLowerCase()));
      },
    },
  };
});

vi.mock("expo-calendar", () => ({
  getCalendarPermissions: async () => ({ granted: state.calendarGranted, canAskAgain: true }),
  requestCalendarPermissions: async () => {
    state.calendarRequests++;
    return { granted: true, canAskAgain: true };
  },
  getCalendars: async () => [{ id: "1", allowsModifications: true, isPrimary: true }],
  listEvents: async () => [],
}));

vi.mock("expo-document-picker", async () => {
  const guard = await import("../../p2p/permissionGuard");
  return {
    getDocumentAsync: async () => {
      state.flagSeenInPicker = guard.isPermissionRequestInFlight();
      return { canceled: true, assets: [] };
    },
  };
});
vi.mock("expo-file-system", () => ({ File: class {} }));
vi.mock("expo-sqlite", () => ({}));
vi.mock("react-native", () => ({ Linking: { openURL: vi.fn() }, Platform: { OS: "android" } }));

import { buildToolHandlers, searchPhoneContacts, upcomingEventsForBriefing } from "./handlers";
import { __resetPermissionGuardForTests } from "../../p2p/permissionGuard";

beforeEach(() => {
  __resetPermissionGuardForTests();
  state.contactsGranted = true;
  state.contactsCanAskAgain = true;
  state.contactsRequests = 0;
  state.getAllDetailsCalls = [];
  state.book = [
    { fullName: "Rubén Díaz", phones: [{ number: "+52 55 1234 5678" }] },
    { fullName: "Ana López", phones: [{ number: "555-111-2222" }] },
  ];
  state.calendarGranted = true;
  state.calendarRequests = 0;
  state.flagSeenInRequest = false;
  state.flagSeenInPicker = false;
});

describe("find_contact en Android (API multiplataforma)", () => {
  it("encuentra el contacto con getAllDetails, sin Container (solo iOS)", async () => {
    const out = await buildToolHandlers().find_contact({ query: "Ana" });
    expect(out).toContain("Ana López — 555-111-2222");
    expect(state.getAllDetailsCalls[0]).toEqual({ fields: ["fullName", "phones"], options: { name: "Ana", limit: 25 } });
  });

  it("'Ruben' encuentra 'Rubén' aunque el filtro nativo distinga acentos", async () => {
    const res = await searchPhoneContacts("Ruben");
    expect(res).toEqual({ ok: true, matches: [{ name: "Rubén Díaz", phones: ["+52 55 1234 5678"] }] });
    // 1ª llamada filtrada (vacía) y 2ª sin filtro, filtrando en el teléfono.
    expect(state.getAllDetailsCalls).toHaveLength(2);
  });

  it("permiso ya concedido → no se pide otra vez (causa del lock screen)", async () => {
    await searchPhoneContacts("Ana");
    await searchPhoneContacts("Ana");
    expect(state.contactsRequests).toBe(0);
  });

  it("permiso pendiente → se pide UNA vez y dentro de la bandera de App.tsx", async () => {
    state.contactsGranted = false;
    await searchPhoneContacts("Ana");
    await searchPhoneContacts("Ana");
    expect(state.contactsRequests).toBe(1);
    expect(state.flagSeenInRequest).toBe(true);
  });

  it("permiso bloqueado ('no volver a preguntar') → explica cómo activarlo, sin abrir nada", async () => {
    state.contactsGranted = false;
    state.contactsCanAskAgain = false;
    const res = await searchPhoneContacts("Ana");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toContain("Ajustes del teléfono");
    expect(state.contactsRequests).toBe(0);
  });
});

describe("calendario y selector de archivos", () => {
  it("list_calendar_events con permiso concedido no vuelve a pedirlo", async () => {
    const out = await buildToolHandlers().list_calendar_events({});
    expect(out).toBe("No hay eventos en ese rango.");
    expect(state.calendarRequests).toBe(0);
  });

  it("read_picked_file abre el selector dentro de la bandera (no bloquea al volver)", async () => {
    const out = await buildToolHandlers().read_picked_file({});
    expect(out).toBe("No elegiste ningún archivo.");
    expect(state.flagSeenInPicker).toBe(true);
  });
});

describe("resumen diario (rutina al arrancar)", () => {
  it("sin permiso de calendario: no lo pide y no mete textos de permiso en el resumen", async () => {
    state.calendarGranted = false;
    expect(await upcomingEventsForBriefing()).toBeNull();
    expect(state.calendarRequests).toBe(0);
  });

  it("con permiso y sin eventos: nada que mostrar", async () => {
    expect(await upcomingEventsForBriefing()).toBeNull();
    expect(state.calendarRequests).toBe(0);
  });
});
