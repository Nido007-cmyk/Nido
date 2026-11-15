/*
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * T-15 · Guardas estructurales del módulo nido-notify (Kotlin).
 *
 * vitest no compila Kotlin: estas sondas leen el texto fuente real y fijan
 * los hechos que la tanda cambia, en el patrón de la casa para lo nativo
 * (como wipeCensus hace con los .kt). El comportamiento del cifrado se
 * comprueba en la JVM con jvm-check/NotifyStoreSealCheck.kt; el del
 * aparato queda declarado como no probado en esta tanda.
 *
 *  - m-58: el almacén de avisos deja de guardar título y cuerpo en claro:
 *    cada entrada se sella con NotifyStoreSeal (AES-256-GCM, clave en el
 *    Android Keystore) antes de tocar SharedPreferences.
 *  - P-24: el receptor reprograma los avisos también cuando cambia la
 *    hora o la zona horaria del teléfono.
 *  - P-25: un elemento no numérico en el patrón de vibración ya no puede
 *    tumbar el canal con un ClassCastException: se rechaza con error
 *    claro antes de crear nada.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MOD = join(ROOT, "modules", "nido-notify", "android", "src", "main");
const engine = readFileSync(join(MOD, "java/expo/modules/nidonotify/NotifyEngine.kt"), "utf8");
const moduleKt = readFileSync(join(MOD, "java/expo/modules/nidonotify/NidoNotifyModule.kt"), "utf8");
const receiver = readFileSync(join(MOD, "java/expo/modules/nidonotify/NidoNotifyReceiver.kt"), "utf8");
const manifest = readFileSync(join(MOD, "AndroidManifest.xml"), "utf8");

describe("m-58 · el almacén de avisos va sellado", () => {
  it("existe la clase pura de sobre sellado, con AES-GCM y prefijo de versión", () => {
    const sealPath = join(MOD, "java/expo/modules/nidonotify/NotifyStoreSeal.kt");
    expect(existsSync(sealPath)).toBe(true);
    const seal = readFileSync(sealPath, "utf8");
    expect(seal).toContain("AES/GCM/NoPadding");
    expect(seal).toContain("\"v1:\"");
  });

  it("el motor sella al guardar: el JSON en claro ya no llega a SharedPreferences", () => {
    expect(engine).not.toContain("putString(r.identifier, toJson(r))");
    expect(engine).toContain("NotifyStoreSeal.seal(");
    expect(engine).toContain("NotifyStoreSeal.open(");
  });

  it("la clave vive en el Android Keystore, con su alias propio", () => {
    expect(engine).toContain("AndroidKeyStore");
    expect(engine).toContain("nido.notify.store.v1");
  });

  it("la lectura distingue lo sellado de lo legado en claro (migración)", () => {
    expect(engine).toContain("NotifyStoreSeal.isSealed(");
  });
});

describe("P-24 · cambio de hora y de zona horaria reprograman los avisos", () => {
  it("el manifiesto declara las dos acciones", () => {
    expect(manifest).toContain("android.intent.action.TIMEZONE_CHANGED");
    expect(manifest).toContain("android.intent.action.TIME_SET");
  });

  it("el receptor manda las dos a rescheduleAll", () => {
    expect(receiver).toContain("Intent.ACTION_TIMEZONE_CHANGED");
    expect(receiver).toContain("Intent.ACTION_TIME_CHANGED");
  });

  it("la constante de Intent es ACTION_TIME_CHANGED: ACTION_TIME_SET no existe (T-44)", () => {
    // En android.content.Intent no hay ningún campo ACTION_TIME_SET:
    // TIME_SET es solo el valor de la cadena de la acción (la que va en
    // el manifiesto, fijada arriba) y el campo se llama
    // ACTION_TIME_CHANGED. La guarda original exigía el nombre malo en
    // el fuente del receptor, y el error solo saltó al compilar el
    // release: «Unresolved reference 'ACTION_TIME_SET'» en
    // :nido-notify:compileReleaseKotlin (run android-apk 43737371704).
    // vitest no compila Kotlin, así que la ausencia de la referencia
    // mala también se fija aquí.
    expect(receiver).not.toContain("Intent.ACTION_TIME_SET");
  });
});

describe("P-25 · el patrón de vibración no revienta con un cast duro", () => {
  it("ya no hay cast `(it as Number)` sobre los elementos de la lista", () => {
    expect(moduleKt).not.toContain("(it as Number)");
  });

  it("la lista se valida entera y se rechaza con error claro si algo no es número", () => {
    expect(moduleKt).toContain("IllegalArgumentException");
    expect(moduleKt).toContain("vibrationPattern");
  });
});
