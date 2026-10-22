/*
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * pqc-cli.c — CI: el ML-KEM-768 nativo de NIDO (mismo C y misma
 * configuración que el APK) compilado para el ordenador de CI. Recibe
 * coins(64) y m(32) en hex; imprime pk, sk, ct, ss y el secreto del rechazo
 * implícito (cifrado con un bit cambiado). scripts/pqc-crosscheck.mjs lo
 * compara con @noble/post-quantum.
 */
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include "nido_mlkem.h"
static void unhex(const char*h, uint8_t*o, size_t n){for(size_t i=0;i<n;i++){unsigned v;sscanf(h+2*i,"%2x",&v);o[i]=(uint8_t)v;}}
static void hex(const uint8_t*b,size_t n){for(size_t i=0;i<n;i++)printf("%02x",b[i]);printf("\n");}
int main(int c,char**v){
  static uint8_t pk[1184],sk[2400],ct[1088],ss[32],ss2[32],coins[64],m[32];
  if(c<3)return 2;
  unhex(v[1],coins,64);unhex(v[2],m,32);
  if(nido_mlkem_keypair(coins,pk,sk))return 3;
  if(nido_mlkem_enc(pk,m,ct,ss))return 4;
  if(nido_mlkem_dec(ct,sk,ss2))return 5;
  if(memcmp(ss,ss2,32))return 6;
  hex(pk,1184);hex(sk,2400);hex(ct,1088);hex(ss,32);
  ct[0]^=1; if(nido_mlkem_dec(ct,sk,ss2))return 7; hex(ss2,32);
  return 0;}
