// MIT License
// Copyright (c) 2026 NIDO contributors
// See LICENSE file for details.

/**
 * withHideOverlays.js — blindaje 0.1.44 contra tapjacking.
 *
 * Una app maliciosa con permiso de "mostrar sobre otras apps" puede dibujar
 * una capa encima de NIDO para engañar al usuario (que toque "Confirmar"
 * creyendo que toca otra cosa) o para tapar un aviso. Desde Android 12
 * (API 31) una app puede pedir al sistema que oculte esas capas de terceros
 * mientras su ventana está en primer plano: Window.setHideOverlayWindows.
 * Exige el permiso normal HIDE_OVERLAY_WINDOWS (sin diálogo).
 *
 * No afecta a superposiciones del sistema (teclado, notificaciones,
 * burbujas del sistema) ni a servicios de accesibilidad.
 *
 * El código inyectado va dentro de try/catch y solo corre en API 31+: si un
 * fabricante no lo soporta, NIDO arranca igual que antes.
 */
const { withMainActivity, AndroidConfig } = require("@expo/config-plugins");

const MARKER = "NIDO blindaje: ocultar superposiciones — plugins/withHideOverlays.js";
const PERMISSION = "android.permission.HIDE_OVERLAY_WINDOWS";

function kotlinBlock(indent) {
  return [
    `${indent}// ${MARKER}`,
    `${indent}if (android.os.Build.VERSION.SDK_INT >= 31) {`,
    `${indent}  try { window.setHideOverlayWindows(true) } catch (_: Exception) {}`,
    `${indent}}`,
  ];
}

function javaBlock(indent) {
  return [
    `${indent}// ${MARKER}`,
    `${indent}if (android.os.Build.VERSION.SDK_INT >= 31) {`,
    `${indent}  try { getWindow().setHideOverlayWindows(true); } catch (Exception ignored) {}`,
    `${indent}}`,
  ];
}

/** Transformación pura e idempotente (probada en withHideOverlays.test.js). */
function applyHideOverlaysToMainActivity(contents) {
  if (contents.includes(MARKER)) return contents;
  const isJava = /\bvoid\s+onCreate\s*\(/.test(contents);
  const lines = contents.split("\n");
  const out = [];
  let injected = false;
  for (const line of lines) {
    out.push(line);
    if (!injected && /^[ \t]*super\.onCreate\(.*\)[ \t]*;?[ \t]*$/.test(line)) {
      const indent = line.match(/^[ \t]*/)[0];
      out.push(...(isJava ? javaBlock(indent) : kotlinBlock(indent)));
      injected = true;
    }
  }
  if (!injected) {
    throw new Error(
      "[withHideOverlays] no se encontró super.onCreate(...) en MainActivity; revisa el template de expo.",
    );
  }
  return out.join("\n");
}

function withHideOverlays(config) {
  config = AndroidConfig.Permissions.withPermissions(config, [PERMISSION]);
  return withMainActivity(config, (c) => {
    c.modResults.contents = applyHideOverlaysToMainActivity(c.modResults.contents);
    return c;
  });
}

module.exports = withHideOverlays;
module.exports.applyHideOverlaysToMainActivity = applyHideOverlaysToMainActivity;
module.exports.MARKER = MARKER;
