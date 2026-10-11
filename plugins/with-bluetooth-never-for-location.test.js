// MIT License
// Copyright (c) 2026 NIDO contributors
// See LICENSE file for details.

/**
 * with-bluetooth-never-for-location.test.js — permisos de Bluetooth/ubicación
 * (auditoría 2026-10-10, L7). Prueba la transformación pura del manifiesto.
 */
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const plugin = require("./with-bluetooth-never-for-location.js");
const { applyBluetoothLocationFlags } = plugin;

const perm = (name, extra = {}) => ({ $: { "android:name": name, ...extra } });
const find = (m, name) => m["uses-permission"].find((p) => p.$["android:name"] === name).$;

describe("with-bluetooth-never-for-location", () => {
  it("marca BLUETOOTH_SCAN como neverForLocation", () => {
    const m = applyBluetoothLocationFlags({ "uses-permission": [perm("android.permission.BLUETOOTH_SCAN")] });
    expect(find(m, "android.permission.BLUETOOTH_SCAN")["android:usesPermissionFlags"]).toBe("neverForLocation");
  });

  it("limita la ubicación a Android 11 o anterior (maxSdkVersion 30)", () => {
    const m = applyBluetoothLocationFlags({
      "uses-permission": [
        perm("android.permission.ACCESS_FINE_LOCATION"),
        perm("android.permission.ACCESS_COARSE_LOCATION"),
      ],
    });
    expect(find(m, "android.permission.ACCESS_FINE_LOCATION")["android:maxSdkVersion"]).toBe("30");
    expect(find(m, "android.permission.ACCESS_COARSE_LOCATION")["android:maxSdkVersion"]).toBe("30");
  });

  it("no sube un maxSdkVersion más restrictivo ya existente", () => {
    const m = applyBluetoothLocationFlags({
      "uses-permission": [perm("android.permission.ACCESS_FINE_LOCATION", { "android:maxSdkVersion": "28" })],
    });
    expect(find(m, "android.permission.ACCESS_FINE_LOCATION")["android:maxSdkVersion"]).toBe("28");
  });

  it("no toca otros permisos ni falla sin lista", () => {
    const m = applyBluetoothLocationFlags({ "uses-permission": [perm("android.permission.WAKE_LOCK")] });
    expect(find(m, "android.permission.WAKE_LOCK")).toEqual({ "android:name": "android.permission.WAKE_LOCK" });
    expect(applyBluetoothLocationFlags({})).toEqual({});
  });

  it("sigue exportando el plugin como función", () => {
    expect(typeof plugin).toBe("function");
  });
});
