/*
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * nido_mlkem.c — build monolítico de mlkem-native (ver nido_mlkem_config.h)
 * y las tres funciones que usa NIDO.
 */
#include "nido_mlkem.h"

#include "mlkem-native/mlkem_native.c"
#include "mlkem-native/mlkem_native.h"

int nido_mlkem_keypair(const uint8_t coins[64], uint8_t pk[NIDO_MLKEM_PK_BYTES],
                       uint8_t sk[NIDO_MLKEM_SK_BYTES]) {
  return nido_mlkem768_keypair_derand(pk, sk, coins);
}

int nido_mlkem_enc(const uint8_t pk[NIDO_MLKEM_PK_BYTES], const uint8_t m[32],
                   uint8_t ct[NIDO_MLKEM_CT_BYTES], uint8_t ss[NIDO_MLKEM_SS_BYTES]) {
  return nido_mlkem768_enc_derand(ct, ss, pk, m);
}

int nido_mlkem_dec(const uint8_t ct[NIDO_MLKEM_CT_BYTES], const uint8_t sk[NIDO_MLKEM_SK_BYTES],
                   uint8_t ss[NIDO_MLKEM_SS_BYTES]) {
  return nido_mlkem768_dec(ss, ct, sk);
}
