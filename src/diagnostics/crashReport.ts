/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * crashReport.ts — formato del informe de cierres (puro, testeable).
 *
 * El informe lo arma el módulo nativo `ram-monitor` (ApplicationExitInfo +
 * traza del último fallo Java/JS). Aquí solo se resume para la UI y se
 * convierte en texto para copiarlo en un issue. No contiene memoria, notas
 * ni mensajes del usuario: solo motivos de cierre y pilas de llamadas.
 * Matiz (SEC-05): una traza puede traer el nombre de un fichero o una ruta
 * técnica dentro del mensaje de una excepción; por eso el bloque del
 * último fallo se sanea al formatear (maskCrashCrumbs, abajo) y al
 * escribir en nativo (scrubCrashText en ram-monitor). Saneamiento
 * conservador, no hermético: una cadena corta del usuario dentro de los
 * primeros 160 caracteres de un mensaje y fuera de llaves puede seguir
 * pasando; es el precio declarado de no destruir el diagnóstico.
 */

export interface ExitInfoLike {
  timestamp: number;
  reason: string;
  description: string | null;
  status: number;
  importance: number;
  pssKb: number;
  rssKb: number;
  trace: string | null;
}

export interface CrashReportLike {
  lastCrash: string | null;
  exits: ExitInfoLike[];
  sdkInt: number;
  device: string;
}

/** Motivos de cierre que indican un fallo (no un cierre normal del usuario). */
const FAILURE_REASONS = new Set([
  "CRASH",
  "CRASH_NATIVE",
  "ANR",
  "LOW_MEMORY",
  "SIGNALED",
  "INITIALIZATION_FAILURE",
  "EXCESSIVE_RESOURCE_USAGE",
]);

export function isFailureExit(e: ExitInfoLike): boolean {
  return FAILURE_REASONS.has(e.reason);
}

/** El cierre por fallo más reciente, o null si no hubo. */
export function latestFailure(report: CrashReportLike): ExitInfoLike | null {
  const sorted = [...report.exits].sort((a, b) => b.timestamp - a.timestamp);
  return sorted.find(isFailureExit) ?? null;
}

const MB = 1024;

/** Rótulos del informe, localizables desde la tarjeta (auditoría
 * 2026-10-12: el informe salía siempre en español). Sin `strings`, se
 * usan los rótulos en español de siempre. */
export interface CrashReportStrings {
  exitsTitle: string;
  noRecords: string;
  traceLabel: string;
  lastCrashTitle: string;
  noneLabel: string;
}

const ES_STRINGS: CrashReportStrings = {
  exitsTitle: "== Últimos cierres (Android) ==",
  noRecords: "(sin registros)",
  traceLabel: "  traza:",
  lastCrashTitle: "== Último fallo Java/JS ==",
  noneLabel: "(ninguno)",
};

/**
 * SEC-05, capa B (al copiar/enseñar): sanea UNA línea del bloque
 * `lastCrash`. Se conserva todo lo que diagnostica — clases de excepción,
 * marcos, la estructura y el texto de los mensajes — y se cortan solo las
 * formas con datos del usuario:
 *  B1. Rutas del sistema de ficheros y URIs file:/content: → «<ruta>»
 *      (las mismas regex que la capa A en nativo; defensa en profundidad
 *      para ficheros escritos por builds anteriores a ella).
 *  B2. Toda corrida {…} o […] de más de 40 caracteres → {<contenido>} /
 *      [<contenido>]: mata el fragmento que una JSONException pega a su
 *      mensaje y cualquier volcado de objeto, conservando la clase y la
 *      posición del error.
 *  B3. Tope de 160 caracteres por línea de mensaje, con «…». Los marcos
 *      (sangría + «at ») y las líneas time=/thread= quedan exentos.
 * Las salidas de ApplicationExitInfo NO pasan por aquí: son otro canal
 * (solo hilos y código), vigilado aparte.
 */
export function maskCrashCrumbs(line: string): string {
  let out = line.replace(/\/(data|storage|sdcard|mnt|vendor)\/[^\s:]*/g, "<ruta>");
  out = out.replace(/(file|content):\/\/[^\s]*/g, "<ruta>");
  out = maskBracketRuns(out);
  const isFrame = /^\s*at\s/.test(out);
  const isHeader = out.startsWith("time=") || out.startsWith("thread=");
  if (!isFrame && !isHeader && out.length > 160) out = `${out.slice(0, 160)}…`;
  return out;
}

/** B2 de maskCrashCrumbs: sustituye el interior de las corridas {…}/[…] largas. */
function maskBracketRuns(line: string): string {
  let out = "";
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === "{" || ch === "[") {
      const close = ch === "{" ? "}" : "]";
      let depth = 0;
      let j = i;
      while (j < line.length) {
        if (line[j] === ch) depth++;
        else if (line[j] === close) {
          depth--;
          if (depth === 0) break;
        }
        j++;
      }
      if (j < line.length) {
        const run = line.slice(i, j + 1);
        out += run.length > 40 ? `${ch}<contenido>${close}` : run;
        i = j + 1;
        continue;
      }
    }
    out += ch;
    i++;
  }
  return out;
}

/** Texto plano para copiar en un reporte de error. */
export function formatCrashReport(report: CrashReportLike, appVersion: string, strings: CrashReportStrings = ES_STRINGS): string {
  const lines: string[] = [];
  lines.push(`NIDO ${appVersion} · ${report.device} · Android SDK ${report.sdkInt}`);
  lines.push("");
  lines.push(strings.exitsTitle);
  if (report.exits.length === 0) {
    lines.push(strings.noRecords);
  }
  const sorted = [...report.exits].sort((a, b) => b.timestamp - a.timestamp);
  for (const e of sorted) {
    const when = new Date(e.timestamp).toISOString();
    const mem = e.rssKb > 0 ? ` · RSS ${Math.round(e.rssKb / MB)} MB` : "";
    lines.push(`- ${when} ${e.reason} (status ${e.status})${mem}${e.description ? ` · ${e.description}` : ""}`);
    if (e.trace) {
      lines.push(strings.traceLabel);
      for (const l of e.trace.split("\n").slice(0, 60)) lines.push(`    ${l}`);
    }
  }
  lines.push("");
  lines.push(strings.lastCrashTitle);
  // SEC-05: solo el bloque lastCrash se sanea (capa B); las salidas de
  // ApplicationExitInfo de arriba no se tocan.
  lines.push(
    report.lastCrash === null ? strings.noneLabel : report.lastCrash.split("\n").map(maskCrashCrumbs).join("\n"),
  );
  return lines.join("\n");
}
