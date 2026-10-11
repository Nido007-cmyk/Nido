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

/** Texto plano para copiar en un reporte de error. */
export function formatCrashReport(report: CrashReportLike, appVersion: string): string {
  const lines: string[] = [];
  lines.push(`NIDO ${appVersion} · ${report.device} · Android SDK ${report.sdkInt}`);
  lines.push("");
  lines.push("== Últimos cierres (Android) ==");
  if (report.exits.length === 0) {
    lines.push("(sin registros)");
  }
  const sorted = [...report.exits].sort((a, b) => b.timestamp - a.timestamp);
  for (const e of sorted) {
    const when = new Date(e.timestamp).toISOString();
    const mem = e.rssKb > 0 ? ` · RSS ${Math.round(e.rssKb / MB)} MB` : "";
    lines.push(`- ${when} ${e.reason} (status ${e.status})${mem}${e.description ? ` · ${e.description}` : ""}`);
    if (e.trace) {
      lines.push("  traza:");
      for (const l of e.trace.split("\n").slice(0, 60)) lines.push(`    ${l}`);
    }
  }
  lines.push("");
  lines.push("== Último fallo Java/JS ==");
  lines.push(report.lastCrash ?? "(ninguno)");
  return lines.join("\n");
}
