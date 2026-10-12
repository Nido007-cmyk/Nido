/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */
import { describe, expect, it } from "vitest";
import { describeP2PError } from "./p2pErrorText";
import en from "../i18n/locales/en.json";
import es from "../i18n/locales/es.json";
import pt from "../i18n/locales/pt.json";

const k = (e: unknown) => describeP2PError(e).key.replace("nido.errors.", "");

describe("describeP2PError", () => {
  it.each([
    ["Primero crea tu identidad NIDO.", "noIdentity"],
    ["Ese es tu propio QR.", "ownQr"],
    ["La clave de firma del QR no es válida.", "qrInvalid"],
    ["El QR de NIDO está dañado.", "qrInvalid"],
    ["Contacto revocado.", "revoked"],
    ["El Bluetooth está apagado.", "bluetoothOff"],
    ["Ni Bluetooth ni Wi-Fi local están disponibles.", "noRadio"],
    ["Falta el permiso BLUETOOTH_CONNECT.", "permission"],
    ["NIDO necesita permisos de Bluetooth para hablar con otro NIDO.", "permission"],
    ["Handshake agotado (15 s): el otro lado no respondió como NIDO.", "connection"],
    ["Fin del stream.", "connection"],
    ["read failed, socket might closed or timeout, read ret: -1", "connection"],
    ["NPE interno en connect() con AA:BB (stack del OEM).", "connection"],
    ["HELLO sin firma válida.", "connection"],
    ["HELLO de versión desconocida.", "versionMismatch"],
    ["Handshake duplicado: ya hay una sesión activa con este contacto.", "alreadyConnected"],
    ["db locked", "busy"],
  ])("%s → %s", (msg, key) => {
    expect(k(new Error(msg))).toBe(key);
  });

  it("keeps the name / alias", () => {
    expect(describeP2PError(new Error("Ya tienes un contacto vivo llamado «Ana». Elige otro nombre."))).toEqual({
      key: "nido.errors.duplicateName",
      vars: { name: "Ana" },
    });
    expect(describeP2PError(new Error("No encontré una dirección Bluetooth ni Wi-Fi local en «tab-2»."))).toEqual({
      key: "nido.errors.noAddress",
      vars: { alias: "tab-2" },
    });
  });

  it("native codes and unknown errors", () => {
    expect(k(Object.assign(new Error("x"), { code: "PERM_ERROR" }))).toBe("permission");
    expect(k(Object.assign(new Error("x"), { code: "BT_CONNECT" }))).toBe("connection");
    expect(describeP2PError(new Error("algo raro"))).toEqual({ key: "nido.errors.generic", vars: { detail: "algo raro" } });
    expect(describeP2PError("texto")).toEqual({ key: "nido.errors.generic", vars: { detail: "texto" } });
    expect(describeP2PError(undefined).key).toBe("nido.errors.generic");
  });

  it("every key exists in every language, with its variables", () => {
    const keys = ["noIdentity", "ownQr", "qrInvalid", "duplicateName", "noAddress", "contactSaveFailed", "revoked", "revokeUnsupported", "versionMismatch", "bluetoothOff", "noRadio", "permission", "alreadyConnected", "busy", "connection", "generic"];
    for (const loc of [es, en, pt] as Array<{ nido: { errors: Record<string, string> } }>) {
      for (const key of keys) expect(loc.nido.errors[key], key).toBeTruthy();
      expect(loc.nido.errors.duplicateName).toContain("{{name}}");
      expect(loc.nido.errors.noAddress).toContain("{{alias}}");
      expect(loc.nido.errors.generic).toContain("{{detail}}");
    }
  });
});
