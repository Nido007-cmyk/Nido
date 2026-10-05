import { describe, it, expect, vi } from "vitest";

// __DEV__ es un global de React Native: se define para el entorno de test.
vi.hoisted(() => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
});

// Los handlers importan react-native de forma dinámica: se mockea el módulo.
// También se mockean los módulos nativos que no existen fuera del teléfono.
vi.mock("expo-calendar", () => ({}));
vi.mock("expo-contacts", () => ({}));
vi.mock("expo-document-picker", () => ({}));
vi.mock("expo-file-system", () => ({ File: class {} }));
vi.mock("expo-sqlite", () => ({}));
vi.mock("react-native", () => ({ Linking: { openURL: vi.fn() }, Platform: { OS: "android" } }));

import { SENSITIVE_TOOLS, confirmBlockedMessage, withConfirmation } from "./confirm";
import { buildToolHandlers } from "./handlers";

describe("confirm: puerta de confirmación", () => {
  it("SENSITIVE_TOOLS declara las herramientas con efectos externos silenciosos", () => {
    expect(SENSITIVE_TOOLS.has("create_calendar_event")).toBe(true);
    expect(SENSITIVE_TOOLS.has("nido_send_message")).toBe(true);
    // nido_pair: emparejar verifica una identidad ajena; el modelo de
    // confianza exige que un humano haya visto el QR en persona.
    expect(SENSITIVE_TOOLS.has("nido_pair")).toBe(true);
    // M-6: decidir sobre una tarea remota encolada es una acción sensible.
    expect(SENSITIVE_TOOLS.has("nido_approve_task")).toBe(true);
    expect(SENSITIVE_TOOLS.has("nido_reject_task")).toBe(true);
    // P-F1: abrir un enlace externo cambia de app; requiere confirmación.
    expect(SENSITIVE_TOOLS.has("open_app")).toBe(true);
    expect(SENSITIVE_TOOLS.has("nido_review_tasks")).toBe(false); // solo lectura
    // place_call/send_sms ya confirman en el SO; el resto no tiene efectos externos.
    expect(SENSITIVE_TOOLS.has("place_call")).toBe(false);
    expect(SENSITIVE_TOOLS.has("save_note")).toBe(false);
  });

  it("confirmado → ejecuta el handler", async () => {
    const inner = vi.fn(async () => "hecho");
    const wrapped = withConfirmation("x", inner, async () => true, () => ({
      tool: "x",
      title: "T",
      message: "M",
    }));
    await expect(wrapped({})).resolves.toBe("hecho");
    expect(inner).toHaveBeenCalledOnce();
  });

  it("cancelado → NO ejecuta y avisa", async () => {
    const inner = vi.fn(async () => "hecho");
    const wrapped = withConfirmation("x", inner, async () => false, () => ({
      tool: "x",
      title: "T",
      message: "M",
    }));
    const out = await wrapped({});
    expect(out).toMatch(/I did nothing/i);
    expect(inner).not.toHaveBeenCalled();
  });

  it("si el diálogo lanza → no se ejecuta (fail-closed)", async () => {
    const inner = vi.fn(async () => "hecho");
    const wrapped = withConfirmation(
      "x",
      inner,
      async () => {
        throw new Error("ui rota");
      },
      () => ({ tool: "x", title: "T", message: "M" }),
    );
    const out = await wrapped({});
    expect(out).toMatch(/I did nothing/i);
    expect(inner).not.toHaveBeenCalled();
  });

  it("M-3: sin canal de confirmación → NO ejecuta (fail-closed)", async () => {
    const inner = vi.fn(async () => "hecho");
    const wrapped = withConfirmation("x", inner, undefined, () => ({
      tool: "x",
      title: "T",
      message: "M",
    }));
    const out = await wrapped({});
    expect(inner).not.toHaveBeenCalled();
    expect(out).toMatch(/blocked for security/i);
    expect(out).toMatch(/was NOT executed/i);
  });

  it("M-3: si describe lanza (no hay consentimiento informado posible) → fail-closed", async () => {
    const inner = vi.fn(async () => "hecho");
    const wrapped = withConfirmation(
      "x",
      inner,
      async () => true, // el canal existe, pero no se llega a usar
      () => {
        throw new Error("no se pudo describir la acción");
      },
    );
    const out = await wrapped({});
    expect(inner).not.toHaveBeenCalled();
    expect(out).toMatch(/blocked for security/i);
  });

  it("M-3: canal roto (reject) → NO ejecuta", async () => {
    const inner = vi.fn(async () => "hecho");
    const wrapped = withConfirmation(
      "x",
      inner,
      async () => Promise.reject(new Error("canal caído")),
      () => ({ tool: "x", title: "T", message: "M" }),
    );
    const out = await wrapped({});
    expect(inner).not.toHaveBeenCalled();
    expect(out).toMatch(/I did nothing/i);
  });

  it("el diálogo recibe un resumen claro de la acción", async () => {
    const seen: Array<{ title: string; message: string }> = [];
    const wrapped = withConfirmation(
      "create_calendar_event",
      async () => "hecho",
      async (req) => {
        seen.push(req);
        return true;
      },
      (args) => ({
        tool: "create_calendar_event",
        title: "Crear evento",
        message: `¿Crear «${args.title}»?`,
      }),
    );
    await wrapped({ title: "Dentista" });
    expect(seen[0].message).toContain("Dentista");
  });
});

describe("confirm: integración con handlers", () => {
  it("create_calendar_event cancelado no toca el calendario", async () => {
    const h = buildToolHandlers({ requestConfirm: async () => false });
    const out = await h["create_calendar_event"]({ title: "X", start: "2026-09-28T10:00:00" });
    expect(out).toMatch(/I did nothing/i);
  });

  it("create_calendar_event confirmado pasa la puerta y llega al handler", async () => {
    const h = buildToolHandlers({ requestConfirm: async () => true });
    // Con expo-calendar mockeado como ausente: el handler se ejecuta y
    // devuelve el motivo de indisponibilidad (la puerta ya se abrió).
    const out = await h["create_calendar_event"]({ title: "X", start: "2026-09-28T10:00:00" });
    expect(out).toMatch(/no está disponible/i);
  });

  it("nido_send_message cancelado no envía nada", async () => {
    const h = buildToolHandlers({ requestConfirm: async () => false });
    const out = await h["nido_send_message"]({ to: "Beto", text: "hola" });
    expect(out).toMatch(/I did nothing/i);
  });

  it("nido_pair cancelado no empareja a nadie", async () => {
    const h = buildToolHandlers({ requestConfirm: async () => false });
    const out = await h["nido_pair"]({ code: "NIDO1:{}" });
    expect(out).toMatch(/I did nothing/i);
  });

  it("nido_pair muestra nombre + huella en el diálogo antes de emparejar", async () => {
    const { generateIdentity } = await import("../../p2p/crypto");
    const { encodePairingPayload } = await import("../../p2p/pairing");
    const id = generateIdentity();
    const sign = generateIdentity();
    const code = encodePairingPayload("Beto", id.publicKey, sign.publicKey);
    const seen: Array<{ title: string; message: string }> = [];
    const h = buildToolHandlers({
      requestConfirm: async (req) => {
        seen.push(req);
        return false;
      },
    });
    const out = await h["nido_pair"]({ code });
    expect(out).toMatch(/I did nothing/i);
    expect(seen).toHaveLength(1);
    expect(seen[0].message).toContain("Beto");
    // La huella va en el formato de 8 grupos hex que el otro NIDO muestra
    // en persona para cotejo verbal (independiente del idioma del diálogo).
    expect(seen[0].message).toMatch(/[0-9a-f]{4}( [0-9a-f]{4}){7}/);
  });

  it("nido_pair con QR inválido avisa sin emparejar", async () => {
    const seen: Array<{ title: string; message: string }> = [];
    const h = buildToolHandlers({
      requestConfirm: async (req) => {
        seen.push(req);
        return false;
      },
    });
    const out = await h["nido_pair"]({ code: "esto-no-es-un-qr" });
    expect(out).toMatch(/I did nothing/i);
    expect(seen).toHaveLength(1);
    expect(seen[0].message).not.toContain("Beto");
  });

  it("M-3: sin requestConfirm, NINGUNA herramienta sensible se ejecuta", async () => {
    const h = buildToolHandlers(); // sin canal de confirmación
    const args = {
      title: "X",
      start: "2026-09-28T10:00:00",
      to: "Beto",
      text: "hola",
      code: "NIDO1:{}",
      link: "https://nido.example/x",
    };
    for (const tool of [
      "create_calendar_event",
      "nido_send_message",
      "nido_pair",
      "nido_approve_task",
      "nido_reject_task",
      "open_app",
    ]) {
      const out = await h[tool](args);
      // El texto es EXACTAMENTE el bloqueo M-3: ningún handler produjo su
      // propio resultado (ni éxito ni su error interno) → no se ejecutó.
      expect(out).toBe(confirmBlockedMessage(tool));
    }
  });
});
