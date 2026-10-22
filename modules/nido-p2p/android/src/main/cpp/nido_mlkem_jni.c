/*
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * nido_mlkem_jni.c — puente JNI de ML-KEM-768 (mlkem-native) para
 * expo.modules.nidop2p.NidoPqc. Devuelve null ante cualquier error (tamaños
 * incorrectos, clave pública rechazada, sin memoria). Los secretos que pasan
 * por buffers de C se borran antes de volver.
 */
#include <jni.h>
#include <string.h>

#include "nido_mlkem.h"

static void nido_zero(void *p, size_t n) {
  volatile unsigned char *v = (volatile unsigned char *)p;
  while (n--) *v++ = 0;
}

/* Copia un byte[] de Java de tamaño exacto `want` a `out`. 0 si va bien. */
static int nido_take(JNIEnv *env, jbyteArray arr, uint8_t *out, jsize want) {
  if (arr == NULL || (*env)->GetArrayLength(env, arr) != want) return -1;
  (*env)->GetByteArrayRegion(env, arr, 0, want, (jbyte *)out);
  return (*env)->ExceptionCheck(env) ? -1 : 0;
}

static jbyteArray nido_give(JNIEnv *env, const uint8_t *a, jsize na, const uint8_t *b, jsize nb) {
  jbyteArray out = (*env)->NewByteArray(env, na + nb);
  if (out == NULL) return NULL;
  (*env)->SetByteArrayRegion(env, out, 0, na, (const jbyte *)a);
  if (nb > 0) (*env)->SetByteArrayRegion(env, out, na, nb, (const jbyte *)b);
  return out;
}

/* coins(64) → pk(1184) || sk(2400) */
JNIEXPORT jbyteArray JNICALL
Java_expo_modules_nidop2p_NidoPqc_nativeKeypair(JNIEnv *env, jclass clazz, jbyteArray coinsArr) {
  (void)clazz;
  uint8_t coins[64], pk[NIDO_MLKEM_PK_BYTES], sk[NIDO_MLKEM_SK_BYTES];
  jbyteArray out = NULL;
  if (nido_take(env, coinsArr, coins, 64) == 0 && nido_mlkem_keypair(coins, pk, sk) == 0) {
    out = nido_give(env, pk, NIDO_MLKEM_PK_BYTES, sk, NIDO_MLKEM_SK_BYTES);
  }
  nido_zero(coins, sizeof coins);
  nido_zero(sk, sizeof sk);
  return out;
}

/* pk(1184), m(32) → ct(1088) || ss(32) */
JNIEXPORT jbyteArray JNICALL
Java_expo_modules_nidop2p_NidoPqc_nativeEncaps(JNIEnv *env, jclass clazz, jbyteArray pkArr, jbyteArray mArr) {
  (void)clazz;
  uint8_t pk[NIDO_MLKEM_PK_BYTES], m[32], ct[NIDO_MLKEM_CT_BYTES], ss[NIDO_MLKEM_SS_BYTES];
  jbyteArray out = NULL;
  if (nido_take(env, pkArr, pk, NIDO_MLKEM_PK_BYTES) == 0 && nido_take(env, mArr, m, 32) == 0 &&
      nido_mlkem_enc(pk, m, ct, ss) == 0) {
    out = nido_give(env, ct, NIDO_MLKEM_CT_BYTES, ss, NIDO_MLKEM_SS_BYTES);
  }
  nido_zero(m, sizeof m);
  nido_zero(ss, sizeof ss);
  return out;
}

/* ct(1088), sk(2400) → ss(32) */
JNIEXPORT jbyteArray JNICALL
Java_expo_modules_nidop2p_NidoPqc_nativeDecaps(JNIEnv *env, jclass clazz, jbyteArray ctArr, jbyteArray skArr) {
  (void)clazz;
  uint8_t ct[NIDO_MLKEM_CT_BYTES], sk[NIDO_MLKEM_SK_BYTES], ss[NIDO_MLKEM_SS_BYTES];
  jbyteArray out = NULL;
  if (nido_take(env, ctArr, ct, NIDO_MLKEM_CT_BYTES) == 0 && nido_take(env, skArr, sk, NIDO_MLKEM_SK_BYTES) == 0 &&
      nido_mlkem_dec(ct, sk, ss) == 0) {
    out = nido_give(env, ss, NIDO_MLKEM_SS_BYTES, NULL, 0);
  }
  nido_zero(sk, sizeof sk);
  nido_zero(ss, sizeof ss);
  return out;
}
