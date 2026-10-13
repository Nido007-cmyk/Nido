// MIT License
// Copyright (c) 2026 NIDO contributors
// See LICENSE file for details.
//
// Stub universal de expo-modules-core para Jest: su entrada es
// TypeScript sin transformar y todo módulo expo la importa. Ningún test
// de componentes ejercita módulos nativos; este proxy devuelve un
// callable/construible inofensivo para cualquier nombre que se pida.
const handler = {
  get(target, prop) {
    if (prop === "__esModule") return true;
    if (prop === "default") return universal;
    if (!(prop in target)) target[prop] = universal;
    return target[prop];
  },
  apply() {
    return new Proxy({}, handler);
  },
  construct() {
    return new Proxy({}, handler);
  },
};
const universal = new Proxy(function () {}, handler);
module.exports = universal;
