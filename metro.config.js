/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// Configuración de Metro: los valores por defecto de Expo, más UNA
// regla (T-17, 0.1.99, P-40).
//
// En producción, la pantalla dev del PoC V42 (src/ui/dev/) se
// resuelve a un módulo vacío (metro.empty-module.js): App.tsx la
// carga diferida tras __DEV__, pero Metro sigue los require() de
// forma estática y el módulo real viajaba en el bundle de release
// aunque nunca se montara. Con la redirección, en release ese
// código (y con él assets/poc/, al que solo él llega) no entra en
// el grafo; la resolución no se rompe porque el destino existe.
// En desarrollo la regla no se aplica: la ruta dev abre igual.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

if (process.env.NODE_ENV === "production") {
  const emptyModule = path.resolve(__dirname, "metro.empty-module.js");
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (/(^|[/\\])src[/\\]ui[/\\]dev[/\\]/.test(moduleName)) {
      return { type: "sourceFile", filePath: emptyModule };
    }
    return context.resolveRequest(context, moduleName, platform);
  };
}

module.exports = config;
