// MIT License
// Copyright (c) 2026 NIDO contributors
// See LICENSE file for details.
//
// CI: compara el ML-KEM-768 nativo de NIDO (scripts/pqc-cli.c) con
// @noble/post-quantum, byte a byte: pk, sk, ct, ss y rechazo implícito.
// Uso: node scripts/pqc-crosscheck.mjs <cli> <n> [--github]
import { ml_kem768 } from "@noble/post-quantum/ml-kem.js";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const [cli, nArg] = process.argv.slice(2);
const github = process.argv.includes("--github");
const N = Number(nArg || 200);
const hex = (b) => Buffer.from(b).toString("hex");
const names = ["pk", "sk", "ct", "ss", "rechazo implícito"];
for (let i = 0; i < N; i++) {
  // Además de valores al azar, los extremos: todo ceros y todo 0xff.
  const coins = i === 0 ? Buffer.alloc(64) : i === 1 ? Buffer.alloc(64, 0xff) : randomBytes(64);
  const m = i === 0 ? Buffer.alloc(32) : i === 1 ? Buffer.alloc(32, 0xff) : randomBytes(32);
  const out = execFileSync(cli, [coins.toString("hex"), m.toString("hex")]).toString().trim().split("\n");
  const kp = ml_kem768.keygen(new Uint8Array(coins));
  const e = ml_kem768.encapsulate(kp.publicKey, new Uint8Array(m));
  const bad = new Uint8Array(e.cipherText);
  bad[0] ^= 1;
  const exp = [hex(kp.publicKey), hex(kp.secretKey), hex(e.cipherText), hex(e.sharedSecret), hex(ml_kem768.decapsulate(bad, kp.secretKey))];
  for (let j = 0; j < exp.length; j++) {
    if (exp[j] !== out[j]) {
      const msg = `DISTINTOS en la prueba ${i}: ${names[j]}`;
      console.log(github ? `::error title=ML-KEM nativo::${msg}` : msg);
      process.exit(1);
    }
  }
}
const msg = `IGUALES: ${N}/${N} pruebas (pk, sk, ct, ss y rechazo implícito) entre mlkem-native y @noble/post-quantum`;
console.log(github ? `::notice title=ML-KEM nativo (${process.arch})::${msg}` : msg);
