/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// Reading and summarizing evaluation result rows (see docs/EVAL_QUERIES.md).
// Shared by scripts/eval-summary.mjs and scripts/eval-device.mjs.

/** Rows from JSONL text or a Metro log (lines containing "[EVAL] {"). */
export function parseRows(text) {
  const rows = [];
  for (const line of text.split("\n")) {
    const at = line.indexOf("[EVAL] {");
    const json = at >= 0 ? line.slice(at + "[EVAL] ".length) : line.trim().startsWith("{") ? line.trim() : null;
    if (!json) continue;
    try {
      const r = JSON.parse(json);
      if (r.runId && r.configId && r.queryId) rows.push(r);
    } catch {
      // not a result row
    }
  }
  return rows;
}

/** Dedupes by runId + configId + queryId, keeping the last occurrence. */
export function dedupeRows(rows) {
  const byKey = new Map();
  for (const r of rows) byKey.set(`${r.runId}|${r.configId}|${r.queryId}`, r);
  return [...byKey.values()];
}

const nums = (values) => values.filter((x) => typeof x === "number" && Number.isFinite(x));

export function median(values) {
  const v = nums(values).sort((a, b) => a - b);
  if (v.length === 0) return undefined;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export function mean(values) {
  const v = nums(values);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : undefined;
}

export function max(values) {
  const v = nums(values);
  return v.length ? Math.max(...v) : undefined;
}

export function groupBy(rows, keyFn) {
  const groups = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  return groups;
}

export const fmtSec = (ms) => (ms == null ? "—" : `${(ms / 1000).toFixed(1)}s`);
export const fmtNum = (n, d = 1) => (n == null ? "—" : n.toFixed(d));
export const fmtGb = (b) => (b == null ? "—" : `${(b / 1024 ** 3).toFixed(2)} GB`);

/** Per-config statistics, computed only from what the device recorded. */
export function configStats(group) {
  const count = (pred) => group.filter(pred).length;
  const loads = group.filter((r) => (r.modelLoadMs ?? 0) > 0).map((r) => r.modelLoadMs);
  const withKb = group.filter((r) => r.expectedKbHit === true || r.expectedKbHit === false);
  return {
    label: group[0].configLabel,
    configId: group[0].configId,
    formats: [...new Set(group.map((r) => r.promptFormat).filter(Boolean))],
    models: [...new Set(group.map((r) => r.modelId).filter(Boolean))],
    n: group.length,
    ok: count((r) => r.outcome === "success"),
    failed: count((r) => r.outcome === "failure"),
    cancelled: count((r) => r.outcome === "cancelled"),
    ttft: { avg: mean(group.map((r) => r.ttftMs)), p50: median(group.map((r) => r.ttftMs)) },
    load: { avg: mean(loads), p50: median(loads), count: loads.length },
    generation: { avg: mean(group.map((r) => r.generationLatencyMs)), p50: median(group.map((r) => r.generationLatencyMs)) },
    total: { avg: mean(group.map((r) => r.totalLatencyMs)), p50: median(group.map((r) => r.totalLatencyMs)) },
    tokPerSec: { avg: mean(group.map((r) => r.tokPerSec)), p50: median(group.map((r) => r.tokPerSec)) },
    peakRss: max(group.map((r) => r.peakRssBytes)),
    residency: {
      cold: count((r) => r.modelResidency === "cold"),
      switched: count((r) => r.modelResidency === "switched"),
      resident: count((r) => r.modelResidency === "resident"),
    },
    planSwitches: group.reduce((s, r) => s + (r.modelSwitches ?? 0), 0),
    crossSwitches: count((r) => r.crossMessageModelSwitch === true),
    retrievalUsed: count((r) => r.retrievalUsed === true),
    kbHit: withKb.length ? `${count((r) => r.expectedKbHit === true)}/${withKb.length}` : "—",
  };
}

const avgP50 = (s, fmt) => `avg ${fmt(s.avg)} · p50 ${fmt(s.p50)}`;

/** The block report printed at the end of a device run. */
export function formatReport(rows) {
  const out = [];
  for (const [runId, runRows] of groupBy(rows, (r) => r.runId)) {
    const first = runRows[0];
    const queries = new Set(runRows.map((r) => r.queryId)).size;
    out.push(`NIDO Device Evaluation — ${runId} (set v${first.evalSetVersion}, ${queries} queries)`);
    out.push("─".repeat(60));
    for (const group of groupBy(runRows, (r) => r.configId).values()) {
      const s = configStats(group);
      out.push("");
      out.push(`${s.label}`);
      out.push(`  Config:          ${s.configId}${s.formats.length ? ` · prompt ${s.formats.join("+")}` : ""}`);
      if (s.configId === "adaptive") out.push(`  Models used:     ${s.models.join(", ") || "—"}`);
      out.push(`  Queries:         ${s.ok} ok · ${s.failed} failed · ${s.cancelled} cancelled (of ${s.n})`);
      out.push(`  TTFT:            ${avgP50(s.ttft, fmtSec)}`);
      const noLoad = s.residency.resident > 0 ? "none (already resident)" : "—";
      out.push(`  Model load:      ${s.load.count ? `${avgP50(s.load, fmtSec)} over ${s.load.count} load(s)` : noLoad}`);
      out.push(`  Generation:      ${avgP50(s.generation, fmtSec)}`);
      out.push(`  Tokens/sec:      ${avgP50(s.tokPerSec, fmtNum)}`);
      out.push(`  Total per query: ${avgP50(s.total, fmtSec)}`);
      out.push(`  Peak RSS:        ${fmtGb(s.peakRss)}`);
      out.push(`  Residency:       cold ${s.residency.cold} · switched ${s.residency.switched} · resident ${s.residency.resident}`);
      out.push(`  Model switches:  ${s.planSwitches} within plans · ${s.crossSwitches} across messages`);
      out.push(`  Retrieval:       used ${s.retrievalUsed}/${s.n} · expected KB article found ${s.kbHit}`);
    }
    const failures = runRows.filter((r) => r.outcome !== "success");
    if (failures.length) {
      out.push("");
      out.push("Not successful:");
      for (const r of failures) out.push(`  ${r.configLabel} / ${r.queryId}: ${r.outcome} — ${r.errorMessage ?? ""}`);
    }
  }
  return out.join("\n");
}

/** One line per run + config. */
export function formatTable(rows) {
  const header = ["run / config", "format", "n", "ok", "fail", "KB hit", "med TTFT", "med tok/s", "med total", "max load", "peak RSS"];
  const table = [...groupBy(rows, (r) => `${r.runId} ${r.configLabel}`)].map(([key, group]) => {
    const s = configStats(group);
    return [
      key,
      s.formats.join("+") || "—",
      String(s.n),
      String(s.ok),
      String(s.failed),
      s.kbHit,
      fmtSec(s.ttft.p50),
      fmtNum(s.tokPerSec.p50),
      fmtSec(s.total.p50),
      fmtSec(max(group.map((r) => r.modelLoadMs))),
      fmtGb(s.peakRss),
    ];
  });
  const widths = header.map((h, i) => Math.max(h.length, ...table.map((row) => row[i].length)));
  const fmt = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join("  ").trimEnd();
  const lines = [fmt(header), widths.map((w) => "-".repeat(w)).join("  "), ...table.map(fmt)];
  const failures = rows.filter((r) => r.outcome !== "success");
  if (failures.length) {
    lines.push("", "not successful:");
    for (const r of failures) lines.push(`  ${r.configLabel} / ${r.queryId}: ${r.outcome} — ${r.errorMessage ?? ""}`);
  }
  return lines.join("\n");
}

/** Markdown with every config's answer grouped under each query, for manual grading. */
export function formatAnswers(rows) {
  const out = [];
  for (const [queryId, group] of groupBy(rows, (r) => r.queryId)) {
    const first = group[0];
    out.push(`## ${queryId} (${first.category})`, "", `> ${first.query}`, "");
    for (const r of group) {
      const retrieval = r.retrievalUsed ? r.retrievedTitles.join(", ") : "none";
      out.push(`### ${r.configLabel} — ${r.modelId ?? "?"} · ${r.promptFormat ?? "?"} · ${r.outcome} · retrieval: ${retrieval}`, "");
      out.push((r.outcome === "failure" && r.errorMessage) || r.answer || "(empty)", "");
    }
  }
  return out.join("\n");
}
