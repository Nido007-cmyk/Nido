/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * 0.1.55 — Verified facts from knowledge packs (format v2).
 *
 * A pack can carry a `facts` table: each emergency number with its official
 * source, the exact quote from that page and the date it was checked. When a
 * question asks for an emergency number in a country the pack covers, the app
 * answers from that table — no retrieval ranking, no model — and cites the
 * source and date. Pure functions only; reading the pack lives in packs.ts.
 */

export type FactLang = "es" | "en" | "pt";

export interface PackRegion {
  code: string;
  names: Partial<Record<FactLang, string>>;
  /** "en Cuba" / "in Cuba" / "em Cuba". */
  phrases: Partial<Record<FactLang, string>>;
  /** Lower-case aliases match case-insensitively; an alias with capitals ("USA") only matches written that way. */
  aliases: string[];
}

export interface PackFact {
  region: string;
  key: string;
  value: string;
  label: Partial<Record<FactLang, string>>;
  note: Partial<Record<FactLang, string>>;
  sourceTitle: string;
  sourceUrl: string;
  quote: string;
  checked: string;
}

export interface FactsAnswer {
  text: string;
  /** 0.1.55: the numbers in the order the text gives them, for "Call" buttons. */
  calls: Array<{ value: string; label: string; tel: string }>;
  region: string;
  facts: PackFact[];
  /** Short session title ("Emergencias en Chile"). */
  title: string;
  /** 0.1.57: answered from an older version of the pack (the app has a newer one to download). */
  outdated?: boolean;
}

const OUTDATED_NOTE: Record<FactLang, (pack: string) => string> = {
  es: (pack) =>
    `Aviso: este dato viene de una versión anterior del pack «${pack}» guardada en el teléfono. Hay una más nueva: descárgala en Biblioteca › Packs cuando tengas conexión.`,
  en: (pack) =>
    `Note: this comes from an older version of the “${pack}” pack saved on this phone. A newer one is available: download it in Library › Packs when you're online.`,
  pt: (pack) =>
    `Aviso: este dado vem de uma versão anterior do pacote «${pack}» guardada no telefone. Há uma mais nova: baixe-a em Biblioteca › Pacotes quando tiver conexão.`,
};

/**
 * 0.1.57: marks an answer that came from an older pack. The numbers stay (an
 * older verified list beats none, especially offline); the date of each source
 * is already in the text, and this says a newer version exists.
 */
export function markOutdated(answer: FactsAnswer, lang: FactLang, packLabel: string): FactsAnswer {
  return { ...answer, text: `${answer.text}\n\n${OUTDATED_NOTE[lang](packLabel)}`, outdated: true };
}

export function outdatedPackNote(lang: FactLang, packLabel: string): string {
  return OUTDATED_NOTE[lang](packLabel);
}

/** Lower-case, no accents, punctuation as spaces, single spaces. */
export function foldText(text: string): string {
  return ` ${text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
}

function foldKeepCase(text: string): string {
  return ` ${text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()} `;
}

/** The region the text names (longest matching alias wins), or null. */
export function findRegion(text: string, regions: PackRegion[]): PackRegion | null {
  const folded = foldText(text);
  const cased = foldKeepCase(text);
  let best: { region: PackRegion; len: number } | null = null;
  for (const region of regions) {
    const candidates = [...region.aliases, ...Object.values(region.names).filter((n): n is string => !!n)];
    for (const alias of candidates) {
      const caseSensitive = alias !== alias.toLowerCase();
      const needle = caseSensitive ? foldKeepCase(alias) : foldText(alias);
      if (needle.trim().length < 2) continue;
      if ((caseSensitive ? cased : folded).includes(needle) && (!best || needle.length > best.len)) {
        best = { region, len: needle.length };
      }
    }
  }
  return best?.region ?? null;
}

export type ServiceKind = "police" | "ambulance" | "fire" | "general";

const SERVICE_WORDS: Array<[ServiceKind, RegExp]> = [
  ["police", / (policia|policias|police|cops?|carabineros|pnr|pnc) /],
  ["ambulance", / (ambulancia|ambulancias|ambulance|ambulancias|samu|medico|medica|medicas|medicos|medical|doctor|cruz roja|red cross|cruz vermelha|paramedicos?|paramedics?) /],
  ["fire", / (bomberos?|bombeiros?|fire|firefighters?|fire brigade|fire department|incendio|incendios|incendio) /],
  ["general", / (emergencia|emergencias|emergency|emergencies|emergencias|socorro|auxilio|urgencia|urgencias|911|112|9 1 1) /],
];

const NUMBER_CUES = / (numero|numeros|telefono|telefonos|tel|llamo|llamar|llamas|llama|marco|marcar|linea|number|numbers|phone|call|dial|hotline|telefone|telefones|ligo|ligar|discar|disco|contacto|contact) /;

/** Which emergency service the question asks for, or null when it isn't asking for an emergency number. */
export function emergencyQuestionKind(text: string): ServiceKind | null {
  const folded = foldText(text);
  const words = folded.trim().split(" ").filter(Boolean);
  if (words.length === 0 || words.length > 16) return null;
  const kinds = SERVICE_WORDS.filter(([, re]) => re.test(folded)).map(([k]) => k);
  if (kinds.length === 0) return null;
  // "policía en Chile" is a request on its own; longer phrases need a cue
  // ("número", "llamo", "phone"…) so "la historia de los bomberos de Chile" isn't one.
  const asks = NUMBER_CUES.test(folded) || words.length <= 5;
  if (!asks) return null;
  return kinds.find((k) => k !== "general") ?? "general";
}

const SERVICE_KEYS: Record<ServiceKind, string[]> = {
  police: ["emergency.police", "emergency.tourist-police"],
  ambulance: ["emergency.ambulance", "emergency.medical", "emergency.redcross"],
  fire: ["emergency.fire", "emergency.fire-municipal"],
  general: ["emergency.general", "emergency.emergencies"],
};

const T: Record<FactLang, { for: (svc: string, where: string) => string; all: (where: string) => string; others: string; source: string; checked: string; title: (name: string) => string; svc: Record<ServiceKind, string> }> = {
  es: {
    for: (svc, where) => `${cap(where)}, para ${svc}:`,
    all: (where) => `Números de emergencia ${where}:`,
    others: "Otros números:",
    source: "Fuente",
    checked: "comprobado el",
    title: (name) => `Emergencias en ${name}`,
    svc: { police: "la policía", ambulance: "una ambulancia", fire: "los bomberos", general: "emergencias" },
  },
  en: {
    for: (svc, where) => `${cap(where)}, for ${svc}:`,
    all: (where) => `Emergency numbers ${where}:`,
    others: "Other numbers:",
    source: "Source",
    checked: "checked on",
    title: (name) => `Emergencies in ${name}`,
    svc: { police: "the police", ambulance: "an ambulance", fire: "the fire department", general: "emergencies" },
  },
  pt: {
    for: (svc, where) => `${cap(where)}, para ${svc}:`,
    all: (where) => `Números de emergência ${where}:`,
    others: "Outros números:",
    source: "Fonte",
    checked: "verificado em",
    title: (name) => `Emergências em ${name}`,
    svc: { police: "a polícia", ambulance: "uma ambulância", fire: "os bombeiros", general: "emergências" },
  },
};

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function line(f: PackFact, lang: FactLang): string {
  const label = f.label[lang] ?? f.label.en ?? f.key;
  const note = f.note[lang];
  return `• ${f.value} — ${label}${note ? ` (${note})` : ""}`;
}

/**
 * The answer to "what number do I call in X?" from verified facts, or null
 * when the text isn't such a question or no installed pack covers X.
 */
export function composeFactsAnswer(text: string, lang: FactLang, regions: PackRegion[], facts: PackFact[]): FactsAnswer | null {
  const kind = emergencyQuestionKind(text);
  if (!kind) return null;
  const region = findRegion(text, regions);
  if (!region) return null;
  const mine = facts.filter((f) => f.region === region.code && f.key.startsWith("emergency."));
  if (mine.length === 0) return null;
  const t = T[lang];
  const where = region.phrases[lang] ?? region.names[lang] ?? region.code;
  const name = region.names[lang] ?? region.code;

  // The asked-for service first. With a single national number, that number
  // is the answer for any service.
  let first = mine.filter((f) => SERVICE_KEYS[kind].includes(f.key));
  if (first.length === 0 && kind !== "general") first = mine.filter((f) => SERVICE_KEYS.general.includes(f.key));
  const rest = mine.filter((f) => !first.includes(f));

  const out: string[] = [];
  if (kind !== "general" && first.length > 0) {
    out.push(t.for(t.svc[kind], where), ...first.map((f) => line(f, lang)));
    if (rest.length > 0) out.push("", t.others, ...rest.map((f) => line(f, lang)));
  } else {
    out.push(t.all(where), ...[...first, ...rest].map((f) => line(f, lang)));
  }
  const sources = new Map<string, string>();
  for (const f of mine) {
    const prev = sources.get(f.sourceTitle);
    if (!prev || f.checked < prev) sources.set(f.sourceTitle, f.checked);
  }
  out.push("", ...[...sources].map(([title, checked]) => `${t.source}: ${title} (${t.checked} ${checked}).`));
  const ordered = [...first, ...rest];
  const calls = ordered.map((f) => ({ value: f.value, label: f.label[lang] ?? f.label.en ?? f.key, tel: telUri(f.value) }));
  return { text: out.join("\n"), calls, region: region.code, facts: mine, title: t.title(name) };
}

// ---------------------------------------------------------------------------
// 0.1.55: the Emergency tab — the same verified facts, laid out per country.

export interface EmergencyNumber {
  key: string;
  value: string;
  label: string;
  note: string | null;
  /** tel: URI with digits only ("9-1-1" → "tel:911"). */
  tel: string;
}

export interface EmergencyCard {
  code: string;
  name: string;
  /** "en Chile" / "in Chile" / "no Brasil". */
  where: string;
  /** Ambulance (or the single number) first, then police, fire, the rest. */
  numbers: EmergencyNumber[];
  sources: Array<{ title: string; url: string; checked: string }>;
}

const CARD_ORDER = [
  "emergency.general",
  "emergency.ambulance",
  "emergency.medical",
  "emergency.redcross",
  "emergency.police",
  "emergency.fire",
  "emergency.emergencies",
  "emergency.fire-municipal",
  "emergency.civil-protection",
  "emergency.tourist-police",
];

export function telUri(value: string): string {
  return `tel:${value.replace(/[^\d+]/g, "")}`;
}

/** The country's verified numbers in calling order, or null when no pack covers it. */
export function emergencyCard(code: string, lang: FactLang, regions: PackRegion[], facts: PackFact[]): EmergencyCard | null {
  const region = regions.find((r) => r.code === code);
  if (!region) return null;
  const mine = facts.filter((f) => f.region === code && f.key.startsWith("emergency."));
  if (mine.length === 0) return null;
  const rank = (k: string) => {
    const i = CARD_ORDER.indexOf(k);
    return i === -1 ? CARD_ORDER.length : i;
  };
  const sorted = [...mine].sort((a, b) => rank(a.key) - rank(b.key));
  const sources: EmergencyCard["sources"] = [];
  for (const f of sorted) {
    const prev = sources.find((s) => s.title === f.sourceTitle);
    if (!prev) sources.push({ title: f.sourceTitle, url: f.sourceUrl, checked: f.checked });
    else if (f.checked < prev.checked) prev.checked = f.checked;
  }
  return {
    code,
    name: region.names[lang] ?? region.names.en ?? code,
    where: region.phrases[lang] ?? region.names[lang] ?? code,
    numbers: sorted.map((f) => ({
      key: f.key,
      value: f.value,
      label: f.label[lang] ?? f.label.en ?? f.key,
      note: f.note[lang] ?? null,
      tel: telUri(f.value),
    })),
    sources,
  };
}

/** Countries that have at least one verified number, sorted by their name in `lang`. */
export function emergencyRegions(lang: FactLang, regions: PackRegion[], facts: PackFact[]): Array<{ code: string; name: string }> {
  const covered = new Set(facts.filter((f) => f.key.startsWith("emergency.")).map((f) => f.region));
  return regions
    .filter((r) => covered.has(r.code))
    .map((r) => ({ code: r.code, name: r.names[lang] ?? r.names.en ?? r.code }))
    .sort((a, b) => a.name.localeCompare(b.name, lang));
}
