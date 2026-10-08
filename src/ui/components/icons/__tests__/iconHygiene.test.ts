/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * NIDO internal icon system v1 — UI glyph hygiene.
 *
 * After the icon migration, the audited UI surfaces must not render
 * emoji/symbol glyphs as icons, except the explicitly allowlisted ones:
 *
 * - KEEP per owner decision 2026-09-28: 🎭 tone, ⚡ energy/bolt,
 *   🐗 mascot, 🧊/🔀/♻️ model residency, ● recording/telemetry dots,
 *   language flags, theme sun/moon.
 * - INTEGRITY lane 2026-09-28: ⏹/⏸ in ChatScreen message badges replaced
 *   with frozen NidoIcon stop/pause; ⏱ mapped to frozen NidoIcon warning
 *   (§4D glyph mapping closed 2026-10-05).
 * - Out of audited scope (owner to decide later): ▲▼ message feedback
 *   vote glyphs (ChatScreen), EvaluationScreen, SystemMonitor (dead UI),
 *   MarkdownMessage text buttons, dev-only screens.
 * - Box-drawing / arrows inside code comments are not UI.
 *
 * Locale strings (src/i18n/locales/*.json) are inventoried separately:
 * glyphs there are classified as INTENTIONAL (content, not icon) or
 * KNOWN_RESIDUE (icon-in-a-string — replacing them needs a per-surface UI
 * refactor that injects <NidoIcon> next to the text, out of this lane's
 * scope). Anything not in either set fails the test, and the residue sets
 * must keep EN/ES/PT parity.
 *
 * If this test fails on a file you just edited, either map the glyph to a
 * frozen icon (see iconRegistry.ts) or get owner sign-off and extend the
 * allowlist with the reason — never silently widen it.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(dirname(new URL(import.meta.url).pathname), "..", "..", "..", "..", "..");

const MIGRATED = [
  "src/ui/ChatHeader.tsx",
  "src/ui/Drawer.tsx",
  "src/ui/ChatScreen.tsx",
  "src/ui/CatalogItemCard.tsx",
  "src/ui/AccordionSection.tsx",
  "src/ui/ModelSetupScreen.tsx",
  "src/ui/MemorySettings.tsx",
  "src/ui/KnowledgeBaseScreen.tsx",
  "src/ui/PersonalDocumentsManager.tsx",
  "src/ui/components/SourceFootnotes.tsx",
  "src/ui/UsageStatsContent.tsx",
  "src/ui/ExecutionTelemetryScreen.tsx",
  "src/ui/PersonalitySettings.tsx",
  "src/ui/NidoScreen.tsx",
  "src/ui/VoiceInputButton.tsx",
  "src/ui/VoiceSettings.tsx",
  "src/ui/PromptIdeasCarousel.tsx",
  "src/ui/components/ModelLoadErrorCard.tsx",
  "src/ui/SetupWizardScreen.tsx",
];

// Glyphs allowed to remain, with the reason documented above.
const ALLOWLIST = new Set([
  "🎭", // tone selector — KEEP per owner decision
  "⚡", // energy/bolt — KEEP per owner decision (no bolt in frozen set)
  "🐗", // mascot header — brand identity, out of scope
  "🧊", "🔀", "♻️", // model residency — deferred per approved containment
  "●", // recording dot / telemetry pulse — decorative, not an icon
  "▲", "▼", // message feedback votes — out of audited scope (owner decision pending)
]);

const GLYPH_RE =
  /[\u{1F000}-\u{1FAFF}\u2300-\u23FF\u2600-\u27BF\u2B00-\u2BFF]\uFE0F?/u;

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("icon hygiene", () => {
  for (const rel of MIGRATED) {
    it(`${rel} has no non-allowlisted icon glyphs`, () => {
      const src = stripComments(readFileSync(join(SRC, rel), "utf8"));
      const bad: string[] = [];
      src.split("\n").forEach((line, i) => {
        for (const m of line.matchAll(new RegExp(GLYPH_RE, "gu"))) {
          const ch = m[0];
          if (ch === "️" || ALLOWLIST.has(ch)) continue;
          // Language flags + theme sun/moon live in i18n/theme, not these files,
          // but tolerate them if ever referenced here.
          if (/[\u{1F1E6}-\u{1F1FF}]/u.test(ch)) continue;
          bad.push(`L${i + 1}: ${ch}`);
        }
      });
      expect(bad).toEqual([]);
    });
  }

  it("AccordionSection still supports the kept tone/mascot glyphs", () => {
    const src = readFileSync(join(SRC, "src/ui/AccordionSection.tsx"), "utf8");
    expect(src).toContain("isIconName(icon)");
  });
});

/**
 * Locale-string glyph inventory (INTEGRITY lane 2026-09-28).
 *
 * Every glyph found in en/es/pt.json must be CLASSIFIED:
 *
 * INTENTIONAL — content, not an icon. Kept deliberately:
 * - "🎭" roleAssistant — owner KEEP (tone/mascot identity)
 * - "⚡" processingIndicator.generating — owner KEEP (no bolt in frozen set)
 * - "✓" nido.* suffixes/notices — semantic text checkmark, part of the copy
 * - "🟢"/"⚪" nido link status — status dots, same rationale as the ●
 *   recording dot (decorative state marker, not an icon)
 * - "⏳" nido queued — queue-status content inside P2P copy
 * - "⚠" systemMonitor.exceeded — SystemMonitor is dead UI (out of scope,
 *   pending the residue decision; its strings are not migrated surfaces)
 * - "🧪" aboutScreen.benchmarkBody — prose content describing benchmarks,
 *   not a button icon
 *
 * KNOWN_RESIDUE — icon rendered as a glyph inside a localized string.
 * Replacing one needs a per-surface UI refactor (<NidoIcon> next to the
 * text, since icons cannot live inside a translated string). Detected,
 * classified, and DEFERRED — never silently widened.
 *
 * Anything in neither set fails. The residue sets must keep EN/ES/PT
 * parity: the same keys carry glyphs in all three locales.
 */
const LOCALES = ["en", "es", "pt"] as const;

const INTENTIONAL_LOCALE_GLYPHS = new Set([
  "🎭", // roleAssistant — owner KEEP
  "⚡", // processingIndicator.generating — owner KEEP
  "✓", // nido.* — semantic checkmark content
  "🟢", "⚪", // nido link status — status dots (● precedent)
  "⏳", // nido queued — queue-status content
  "⚠", // systemMonitor.exceeded — dead UI, out of scope
  "🧪", // aboutScreen.benchmarkBody — prose content
  "🏕", "💰", "🔧", "📚", "🗺", "🔒", // promptIdeasCarousel.items.*.icon —
  // per-idea illustrative content (NIDO-original), not interface icons
]);

const KNOWN_RESIDUE_LOCALE_GLYPHS = new Set([
  "🔄", // catalogItemCard.retryDownload — icon (frozen: "refresh"); surface refactor deferred
  "📥", // catalogItemCard.downloadAsset — icon (frozen: "download"); deferred
  "🔘", // catalogItemCard.selectUse — icon; deferred
  "⬇", // executionTelemetry/evaluation exports — icon (frozen: "download"); deferred
  "🗑", // executionTelemetry.clear — icon (frozen: "delete"); deferred
  "🔍", // processingIndicator.retrieving — icon (frozen: "search"); deferred
  "🧠", // processingIndicator.thinking — icon (no frozen brain); deferred
  "💭", // chatScreen.reasoning* — icon (no frozen thought bubble); deferred
  "🔬", // chatScreen.research.* — icon (no frozen microscope); deferred
  "✅", // chatScreen.modelDownloadComplete — icon (frozen: "success"); deferred
  "💬", "👥", "🔗", // nido tab labels — P2P UI content; deferred
  "📋", // nido.copyCode — icon (frozen: "copy"); deferred
]);

function localeGlyphMap(locale: string): Map<string, string[]> {
  const raw = JSON.parse(
    readFileSync(join(SRC, "src", "i18n", "locales", `${locale}.json`), "utf8")
  ) as unknown;
  const out = new Map<string, string[]>();
  const walk = (node: unknown, path: string): void => {
    if (typeof node === "string") {
      const glyphs = [...new Set([...node.matchAll(new RegExp(GLYPH_RE, "gu"))].map((m) => m[0]))]
        .filter((g) => g !== "️")
        .sort();
      if (glyphs.length > 0) out.set(path, glyphs);
      return;
    }
    if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k);
    }
  };
  walk(raw, "");
  return out;
}

describe("locale glyph inventory", () => {
  it("every glyph in en/es/pt.json is classified (intentional or known residue)", () => {
    const unknown: string[] = [];
    for (const locale of LOCALES) {
      for (const [path, glyphs] of localeGlyphMap(locale)) {
        for (const g of glyphs) {
          if (INTENTIONAL_LOCALE_GLYPHS.has(g) || KNOWN_RESIDUE_LOCALE_GLYPHS.has(g)) continue;
          // Language flags are content (same tolerance as the .tsx audit).
          if (/[-🇿]/u.test(g)) continue;
          unknown.push(`${locale}:${path} -> ${g}`);
        }
      }
    }
    expect(unknown).toEqual([]);
  });

  it("glyph-bearing keys keep EN/ES/PT parity", () => {
    const maps = LOCALES.map(localeGlyphMap);
    const keySets = maps.map((m) => new Set(m.keys()));
    expect([...keySets[1]].sort()).toEqual([...keySets[0]].sort());
    expect([...keySets[2]].sort()).toEqual([...keySets[0]].sort());
    for (const key of keySets[0]) {
      expect(maps[1].get(key)).toEqual(maps[0].get(key));
      expect(maps[2].get(key)).toEqual(maps[0].get(key));
    }
  });

  it("intentional allowlist is still honored (owner keeps did not regress)", () => {
    const en = localeGlyphMap("en");
    const flat = [...en.values()].flat();
    expect(flat).toContain("🎭");
    expect(flat).toContain("⚡");
    expect(flat).toContain("✓");
  });
});
