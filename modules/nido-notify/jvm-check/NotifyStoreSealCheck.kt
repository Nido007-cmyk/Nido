/*
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// Comprobación en la JVM de NotifyStoreSeal.kt (el sobre sellado del
// almacén de avisos, T-15 m-58). No entra en el APK: la compila y la
// corre scripts/check-notify-store-seal.mjs, en local y en la CI.
//
// Qué se fija aquí (la parte pura; la clave de Android Keystore y las
// SharedPreferences son del aparato y quedan declaradas):
//  1. sellar → abrir devuelve el JSON byte a byte;
//  2. cada sellado lleva un IV distinto (dos sobres del mismo texto
//     difieren) y ambos abren;
//  3. cualquier manipulación del sobre (IV o cifrado) → rechazo (null);
//  4. datos asociados distintos (otro identificador) → rechazo: un sobre
//     trasplantado a otra entrada no abre;
//  5. otra clave → rechazo;
//  6. lo que no lleva el formato (el legado en claro) no se abre como
//     sellado ni cuenta como sellado.

import expo.modules.nidonotify.NotifyStoreSeal
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

private var failures = 0
private var checks = 0

private fun check(ok: Boolean, what: () -> String) {
  checks += 1
  if (!ok) {
    failures += 1
    if (failures <= 20) println("FAIL: ${what()}")
  }
}

private fun newKey(): SecretKey {
  val gen = KeyGenerator.getInstance("AES")
  gen.init(256)
  return gen.generateKey()
}

fun main() {
  val key = newKey()
  val otherKey = newKey()
  val id = "aviso-123"
  val aad = id.toByteArray(Charsets.UTF_8)
  val json = """{"identifier":"aviso-123","title":"Tomar la pastilla","body":"con un vaso de agua","sound":true}"""
  val plain = json.toByteArray(Charsets.UTF_8)

  // 1. Ida y vuelta byte a byte.
  val sealed = NotifyStoreSeal.seal(key, aad, plain)
  check(NotifyStoreSeal.isSealed(sealed)) { "el sobre lleva el prefijo de formato" }
  val opened = NotifyStoreSeal.open(key, aad, sealed)
  check(opened != null && opened.contentEquals(plain)) { "sellado → abierto idéntico" }
  check(opened != null && String(opened, Charsets.UTF_8) == json) { "el JSON abierto es el guardado" }

  // 2. IV aleatorio por entrada.
  val sealed2 = NotifyStoreSeal.seal(key, aad, plain)
  check(sealed != sealed2) { "dos sellados del mismo texto difieren (IV propio)" }
  check(NotifyStoreSeal.open(key, aad, sealed2)?.contentEquals(plain) == true) { "el segundo sobre también abre" }

  // 3. Manipulación: un carácter cambiado en el IV y otro en el cifrado.
  fun flip(s: String, at: Int): String {
    val c = s[at]
    val r = if (c == '0') '1' else '0'
    return s.substring(0, at) + r + s.substring(at + 1)
  }
  check(NotifyStoreSeal.open(key, aad, flip(sealed, 5)) == null) { "IV manipulado → rechazo" }
  check(NotifyStoreSeal.open(key, aad, flip(sealed, sealed.length - 1)) == null) { "cifrado manipulado → rechazo" }
  check(NotifyStoreSeal.open(key, aad, sealed.dropLast(2)) == null) { "sobre truncado → rechazo" }

  // 4. Datos asociados: el sobre es de SU entrada.
  val otherAad = "aviso-999".toByteArray(Charsets.UTF_8)
  check(NotifyStoreSeal.open(key, otherAad, sealed) == null) { "sobre trasplantado a otro identificador → rechazo" }

  // 5. Otra clave no abre.
  check(NotifyStoreSeal.open(otherKey, aad, sealed) == null) { "otra clave → rechazo" }

  // 6. El legado en claro no es un sobre.
  check(!NotifyStoreSeal.isSealed(json)) { "el JSON en claro no cuenta como sellado" }
  check(NotifyStoreSeal.open(key, aad, json) == null) { "el JSON en claro no se abre como sellado" }
  check(NotifyStoreSeal.open(key, aad, "v1:") == null) { "prefijo sin contenido → rechazo" }
  check(NotifyStoreSeal.open(key, aad, "v1:abc") == null) { "hex de longitud impar → rechazo" }
  check(NotifyStoreSeal.open(key, aad, "v1:zzzz") == null) { "hex inválido → rechazo" }

  // Texto vacío: abre a vacío (un aviso sin cuerpo es legítimo).
  val emptySealed = NotifyStoreSeal.seal(key, aad, ByteArray(0))
  check(NotifyStoreSeal.open(key, aad, emptySealed)?.size == 0) { "texto vacío: ida y vuelta" }

  if (failures > 0) {
    println("check-notify-store-seal: FAIL $failures de $checks")
    kotlin.system.exitProcess(1)
  }
  println("check-notify-store-seal: PASS $checks comprobaciones")
}
