/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */
/**
 * 0.1.55 (P-04): motivos por los que NO se llama para no revelar la identidad.
 * p2pErrorText los traduce (nido.errors.private*).
 */
export const PRIVATE_CHECK_FAILED =
  "Saludo privado: no pude comprobar si este contacto lo admite, así que no llamé (tu identidad no salió del teléfono).";
export const PRIVATE_ONLY_OLD_CONTACT =
  "Solo saludo privado: este contacto usa un NIDO antiguo que no lo admite, así que no llamé.";
export const PRIVATE_ONLY_NO_TARGET =
  "Solo saludo privado: este dispositivo no es un contacto conocido, así que no llamé.";
export const PRIVATE_ONLY_PLAIN_HELLO =
  "Solo saludo privado: rechazado un saludo en claro.";
