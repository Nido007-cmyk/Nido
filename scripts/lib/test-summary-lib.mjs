/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Resumen de pruebas que la CI publica en cada corrida (paquete
 * NIDO-MANT-2026-11-13, encargo 4).
 *
 * Por qué existe: las notas de 0.1.94 y 0.1.95 citaron cifras que no se
 * podían comparar. 0.1.94 dio «6,798 passed of 6,820», que es vitest +
 * jest de la CI (6.713 + 107). 0.1.95 dio «vitest 6,682 passed and 46
 * skipped», que es solo vitest y en un árbol local sin sqlcipher3, donde
 * cinco ficheros de SQLCipher real se omiten (24 pruebas más que en la
 * CI). Desde fuera parecía que faltaban 92 pruebas; en la CI eran 24
 * más (6.820 → 6.844).
 *
 * Esta librería convierte los JSON de vitest y jest en una sola forma:
 * por corredor (pasadas, fallidas, omitidas, pendientes y total), los
 * ficheros con pruebas omitidas, y el entorno de la medición (comando,
 * sistema, Node, commit, run). Sin dependencias y sin E/S: la E/S vive
 * en scripts/test-summary.mjs.
 */

/** El comando exacto que la CI corre para cada corredor. */
export const COMMANDS = {
  vitest: "npm test -- --reporter=default --reporter=json --outputFile.json=vitest-results.json",
  jest: "npm run test:components -- --json --outputFile=jest-results.json",
};

const SKIPPED_STATUSES = new Set(["skipped", "pending", "disabled"]);

function relativeName(name, root) {
  const n = String(name ?? "");
  if (root && n.startsWith(root)) return n.slice(root.length).replace(/^[/\\]+/, "");
  return n;
}

/**
 * Cuenta un informe con forma de jest (vitest escribe la misma forma).
 * Devuelve null si no hay informe: un corredor que no llegó a escribir
 * su JSON no se cuenta como cero pruebas pasadas.
 */
export function summarizeRunner(report, root = "") {
  if (!report || typeof report !== "object") return null;
  const files = [];
  const failures = [];
  for (const file of report.testResults ?? []) {
    const counts = { passed: 0, failed: 0, skipped: 0, todo: 0 };
    for (const a of file.assertionResults ?? []) {
      if (a.status === "passed") counts.passed += 1;
      else if (a.status === "failed") {
        counts.failed += 1;
        failures.push({
          file: relativeName(file.name, root),
          test: a.fullName ?? a.title ?? "",
          message: (a.failureMessages ?? []).join(" "),
        });
      } else if (a.status === "todo") counts.todo += 1;
      else if (SKIPPED_STATUSES.has(a.status)) counts.skipped += 1;
    }
    // Un fichero que falla al cargar no tiene aserciones: su mensaje es
    // el único rastro del fallo.
    if (file.status === "failed" && counts.failed === 0) {
      failures.push({ file: relativeName(file.name, root), test: "(file)", message: file.message ?? "" });
    }
    files.push({ file: relativeName(file.name, root), status: file.status ?? "", ...counts });
  }
  return {
    total: report.numTotalTests ?? 0,
    passed: report.numPassedTests ?? 0,
    failed: report.numFailedTests ?? 0,
    skipped: report.numPendingTests ?? 0,
    todo: report.numTodoTests ?? 0,
    files: files.length,
    failedFiles: report.numFailedTestSuites ?? files.filter((f) => f.status === "failed").length,
    skippedByFile: files
      .filter((f) => f.skipped + f.todo > 0)
      .map((f) => ({ file: f.file, skipped: f.skipped, todo: f.todo }))
      .sort((x, y) => x.file.localeCompare(y.file)),
    failures,
    success: report.success === true,
  };
}

/** El entorno de la medición, leído de las variables de GitHub Actions. */
export function environmentFrom(env = {}, nodeVersion = "") {
  const inCi = env.GITHUB_ACTIONS === "true";
  const server = env.GITHUB_SERVER_URL || "https://github.com";
  const run =
    inCi && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID
      ? `${server}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` +
        (env.GITHUB_RUN_ATTEMPT && env.GITHUB_RUN_ATTEMPT !== "1" ? `/attempts/${env.GITHUB_RUN_ATTEMPT}` : "")
      : null;
  return {
    kind: inCi ? "CI" : "local",
    os: env.ImageOS ? `${env.ImageOS}${env.ImageVersion ? ` ${env.ImageVersion}` : ""}` : env.RUNNER_OS || null,
    node: nodeVersion || null,
    commit: env.GITHUB_SHA || null,
    ref: env.GITHUB_REF || null,
    run,
  };
}

export function buildSummary({ vitest, jest, env = {}, nodeVersion = "", root = "" }) {
  const runners = { vitest: summarizeRunner(vitest, root), jest: summarizeRunner(jest, root) };
  const present = Object.values(runners).filter(Boolean);
  const sum = (k) => present.reduce((acc, r) => acc + r[k], 0);
  return {
    schema: 1,
    environment: environmentFrom(env, nodeVersion),
    commands: COMMANDS,
    runners,
    combined: {
      total: sum("total"),
      passed: sum("passed"),
      failed: sum("failed"),
      skipped: sum("skipped"),
      todo: sum("todo"),
      missingRunners: Object.entries(runners)
        .filter(([, r]) => !r)
        .map(([name]) => name),
    },
  };
}

const fmt = (n) => Number(n).toLocaleString("en-US");

/** La línea que una nota de versión puede copiar tal cual. */
export function releaseNotesLine(summary) {
  const { vitest, jest } = summary.runners;
  const parts = [];
  if (vitest)
    parts.push(
      `vitest ${fmt(vitest.passed)} passed, ${fmt(vitest.failed)} failed, ${fmt(vitest.skipped)} skipped of ${fmt(vitest.total)}`,
    );
  if (jest) parts.push(`jest ${fmt(jest.passed)} of ${fmt(jest.total)}`);
  const commands = [vitest && "`npm test`", jest && "`npm run test:components`"].filter(Boolean).join(" + ");
  const env = summary.environment;
  const where = env.kind === "CI" ? `CI${env.os ? `, ${env.os}` : ""}${env.node ? `, Node ${env.node}` : ""}` : "local tree";
  const run = env.run ?? (env.commit ? `local tree at ${env.commit.slice(0, 12)}` : "local tree");
  return `${parts.join("; ")} (command: ${commands}; environment: ${where}; run: ${run})`;
}

/** Markdown para $GITHUB_STEP_SUMMARY. */
export function renderMarkdown(summary) {
  const lines = ["## Test count", ""];
  lines.push("| Runner | Passed | Failed | Skipped | Todo | Total | Files |", "|---|---:|---:|---:|---:|---:|---:|");
  for (const [name, r] of Object.entries(summary.runners)) {
    if (!r) lines.push(`| ${name} | – | – | – | – | – | no report |`);
    else
      lines.push(
        `| ${name} | ${fmt(r.passed)} | ${fmt(r.failed)} | ${fmt(r.skipped)} | ${fmt(r.todo)} | ${fmt(r.total)} | ${fmt(r.files)} |`,
      );
  }
  const c = summary.combined;
  lines.push(
    `| **both** | **${fmt(c.passed)}** | **${fmt(c.failed)}** | **${fmt(c.skipped)}** | **${fmt(c.todo)}** | **${fmt(c.total)}** | |`,
  );
  const env = summary.environment;
  lines.push(
    "",
    `- Environment: ${env.kind}${env.os ? `, ${env.os}` : ""}${env.node ? `, Node ${env.node}` : ""}`,
    `- Commit: ${env.commit ?? "unknown"}`,
    `- Run: ${env.run ?? "none (local)"}`,
    `- vitest command: \`${summary.commands.vitest}\``,
    `- jest command: \`${summary.commands.jest}\``,
    "",
    "Line for the release notes:",
    "",
    "```",
    releaseNotesLine(summary),
    "```",
  );
  const skipped = Object.entries(summary.runners).flatMap(([name, r]) =>
    (r?.skippedByFile ?? []).map((f) => `| ${name} | \`${f.file}\` | ${f.skipped} | ${f.todo} |`),
  );
  if (skipped.length) {
    lines.push(
      "",
      "<details><summary>Files with skipped tests</summary>",
      "",
      "| Runner | File | Skipped | Todo |",
      "|---|---|---:|---:|",
      ...skipped,
      "",
      "</details>",
    );
  }
  const failures = Object.entries(summary.runners).flatMap(([name, r]) =>
    (r?.failures ?? []).map((f) => `- ${name} · \`${f.file}\` · ${f.test}`),
  );
  if (failures.length) lines.push("", "### Failures", "", ...failures);
  return `${lines.join("\n")}\n`;
}

/** Texto seguro para una anotación ::error de GitHub (una línea). */
export function annotationText(message) {
  return String(message)
    .replace(/\u001b\[[0-9;]*m/g, "")
    .slice(0, 1500)
    .replace(/%/g, "%25")
    .replace(/\r?\n/g, "%0A");
}
