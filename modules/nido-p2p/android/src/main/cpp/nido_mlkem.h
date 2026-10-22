/*
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * nido_mlkem.h — ML-KEM-768 (FIPS 203) de mlkem-native, con aleatoriedad
 * externa (variantes *_derand). Todas devuelven 0 si va bien.
 */
#ifndef NIDO_MLKEM_H
#define NIDO_MLKEM_H

#include <stdint.h>

#define NIDO_MLKEM_PK_BYTES 1184
#define NIDO_MLKEM_SK_BYTES 2400
#define NIDO_MLKEM_CT_BYTES 1088
#define NIDO_MLKEM_SS_BYTES 32

/* coins = d || z (64 B), como ML-KEM.KeyGen_internal de FIPS 203. */
int nido_mlkem_keypair(const uint8_t coins[64], uint8_t pk[NIDO_MLKEM_PK_BYTES],
                       uint8_t sk[NIDO_MLKEM_SK_BYTES]);
/* m (32 B), como ML-KEM.Encaps_internal. Rechaza pk con la comprobación de módulo. */
int nido_mlkem_enc(const uint8_t pk[NIDO_MLKEM_PK_BYTES], const uint8_t m[32],
                   uint8_t ct[NIDO_MLKEM_CT_BYTES], uint8_t ss[NIDO_MLKEM_SS_BYTES]);
/* Rechazo implícito: un cifrado alterado da un secreto distinto, no un error. */
int nido_mlkem_dec(const uint8_t ct[NIDO_MLKEM_CT_BYTES], const uint8_t sk[NIDO_MLKEM_SK_BYTES],
                   uint8_t ss[NIDO_MLKEM_SS_BYTES]);

#endif
