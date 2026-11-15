/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// Módulo vacío de producción (T-17, 0.1.99, P-40): metro.config.js
// redirige aquí todo src/ui/dev/ cuando NODE_ENV=production, para
// que la pantalla dev del PoC V42 no viaje en el bundle de release.
// En release nunca se monta (su única puerta es __DEV__), así que
// el componente es un cascarón que no pinta nada; existe para que
// la resolución del require diferido de App.tsx no se rompa.
function CharacterPreviewScreen() {
  return null;
}

module.exports = { CharacterPreviewScreen };
