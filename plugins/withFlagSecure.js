/**
 * withFlagSecure.js
 *
 * P-F2 — FLAG_SECURE: cuando NIDO muestra contenido privado/sensible,
 * Android debe impedir screenshots y screen recording.
 *
 * FLAG_SECURE NO es un atributo de AndroidManifest: solo se puede fijar en
 * código, sobre la ventana de la Activity. Este plugin inyecta
 *   window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
 * en MainActivity.onCreate() mediante el mod `mainActivity` de
 * @expo/config-plugins — reproducible en cada `expo prebuild --clean`,
 * sin tocar android/ generado a mano.
 *
 * Alcance: SOLO la ventana principal (MainActivity). No toca permisos,
 * backup policy, network security, signing ni ningún otro flag.
 *
 * Nota: FLAG_SECURE también oculta la miniatura de la app en el
 * app-switcher (Recents) — es comportamiento inherente del flag en
 * Android, no una medida separada.
 *
 * Verificación física pendiente: Tab A9+ (screenshot + screen recording
 * bloqueados en build release/Hermes).
 */
const { withMainActivity } = require("@expo/config-plugins");

const MARKER = "NIDO P-F2 FLAG_SECURE — plugins/withFlagSecure.js";
const FLAG_CALL_KT =
  "window.addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE)";
const FLAG_CALL_JAVA =
  "getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE);";

/**
 * Pure, deterministic transform — unit-tested in withFlagSecure.test.js.
 *
 * Inserta la llamada FLAG_SECURE justo después de super.onCreate(...) en
 * onCreate(), tanto en el template Kotlin como en el Java. Idempotente y
 * byte-exacto: todo lo demás queda intacto. Si no encuentra el punto de
 * inyección, lanza (fail-closed en prebuild: mejor romper el build con un
 * mensaje claro que publicar una app sin la protección).
 */
function applyFlagSecureToMainActivity(contents) {
  if (contents.includes("WindowManager.LayoutParams.FLAG_SECURE")) {
    return contents; // ya protegido — no duplicar
  }
  const isJava = /\bvoid\s+onCreate\s*\(/.test(contents);
  const flagCall = isJava ? FLAG_CALL_JAVA : FLAG_CALL_KT;
  const commentPrefix = "//";

  const lines = contents.split("\n");
  const out = [];
  let injected = false;
  for (const line of lines) {
    out.push(line);
    if (!injected && /^[ \t]*super\.onCreate\(.*\)[ \t]*;?[ \t]*$/.test(line)) {
      const indent = line.match(/^[ \t]*/)[0];
      out.push(`${indent}${commentPrefix} ${MARKER}`);
      out.push(`${indent}${flagCall}`);
      injected = true;
    }
  }
  if (!injected) {
    throw new Error(
      "[withFlagSecure] no se encontró super.onCreate(...) en MainActivity; " +
        "no se puede aplicar FLAG_SECURE. Revisa el template de expo."
    );
  }
  return out.join("\n");
}

function withFlagSecure(config) {
  return withMainActivity(config, (config) => {
    config.modResults.contents = applyFlagSecureToMainActivity(
      config.modResults.contents
    );
    return config;
  });
}

module.exports = withFlagSecure;
module.exports.applyFlagSecureToMainActivity = applyFlagSecureToMainActivity;
