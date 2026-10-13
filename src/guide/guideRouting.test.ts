/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * The user guide must never promise something the app doesn't do.
 *
 * Every example of every lesson, in every language, goes through the same
 * routers the chat uses, in the same order (ChatScreen.send → agentLoop):
 * self-knowledge → small talk → intent → calculator → contacts → tools →
 * reminders → memory. The path it takes must be the one the guide promises
 * (guideCatalog.ts). Also: every language has the same lessons, the same
 * number of examples, and every nested label ($t(...)) exists.
 */
import { describe, expect, it } from "vitest";
import en from "../i18n/locales/en.json";
import es from "../i18n/locales/es.json";
import pt from "../i18n/locales/pt.json";
import { GUIDE_MODULES, ONBOARDING_ROUTES, type GuideRoute } from "./guideCatalog";
import { matchSmallTalk } from "../agent/loop/smallTalk";
import { classifyIntent } from "../agent/loop/intent";
import { extractCalcAction, extractReminderAction, extractTimerAction } from "../agent/loop/actionRouter";
import { extractContactAction } from "../agent/loop/contactRouter";
import { extractToolAction } from "../agent/loop/toolRouter";
import {
  extractImplicitFact,
  extractPeople,
  extractRememberFact,
  extractSelfName,
} from "../agent/loop/rememberRouter";
import { isGenericMemoryQuestionShape, isMemoryStyleQuery } from "../agent/loop/memoryQuery";
import { answerKnowledgeQueryWithCategory, toIdentityLocale } from "../rag/selfKnowledge";

type Lang = "es" | "en" | "pt";
type Locale = Record<string, unknown>;
const LOCALES: Record<Lang, Locale> = { es, en, pt } as unknown as Record<Lang, Locale>;

interface LessonText {
  id: string;
  title: string;
  what: string;
  examples?: string[];
  steps?: string[];
  tip?: string;
}
interface ModuleText {
  id: string;
  title: string;
  lessons: LessonText[];
}
const guideOf = (lang: Lang) => (LOCALES[lang] as { guide: { modules: ModuleText[]; onboarding: { s2Examples: string[] } } }).guide;

/** The path the chat takes for this text, mirroring ChatScreen.send + agentLoop. */
function routeOf(text: string, lang: Lang): GuideRoute | "selfKnowledge" | "none" {
  if (answerKnowledgeQueryWithCategory(text, toIdentityLocale(lang)) !== null) return "selfKnowledge";
  if (matchSmallTalk(text, lang) !== null) return "smallTalk";
  const intent = classifyIntent(text);
  if (intent === "conversar") {
    // 0.1.25: espejo de la sonda de ChatScreen (0.1.23): una pregunta
    // genérica en primera persona entra al loop cuando lo guardado
    // tiene el dato. Los ejemplos de la lección de Memoria van en
    // pares guardar → preguntar, así que al llegar a la pregunta el
    // dato existe y la ruta real es la memoria. Las preguntas sobre
    // documentos importados NO son de la memoria (la sonda no
    // encontraría el dato en los hechos guardados): siguen a
    // conocimiento, como en la app.
    if (isGenericMemoryQuestionShape(text) && !/document/.test(text.toLowerCase())) return "remember";
    return "knowledge";
  }
  if (extractCalcAction(text)) return "calc";
  if (extractContactAction(text)) return "contact";
  const tool = extractToolAction(text);
  if (tool) return `tool:${tool.kind}`;
  // 0.1.25: el espejo cubre la familia completa del loop actual: el
  // temporizador va antes que el recordatorio (agentLoop), y las
  // declaraciones de memoria se guardan con los extractores de
  // personas, nombre propio y hechos implícitos (puerta 0.1.22), no
  // solo con extractRememberFact.
  if (extractTimerAction(text)) return "reminderCreate";
  if (extractReminderAction(text)) return "reminderCreate";
  if (extractPeople(text).length > 0) return "remember";
  if (extractSelfName(text)) return "remember";
  if (extractRememberFact(text)) return "remember";
  if (extractImplicitFact(text)) return "remember";
  // Las consultas de memoria con forma («¿cómo se llama mi mamá?»)
  // las responde answerMemoryQuery dentro del loop: la puerta las
  // clasifica «recordar» por su forma (isMemoryStyleQuery).
  if (isMemoryStyleQuery(text)) return "remember";
  return "none";
}

describe("user guide — same structure in every language", () => {
  for (const lang of ["es", "en", "pt"] as Lang[]) {
    it(`${lang}: modules and lessons match guideCatalog`, () => {
      const g = guideOf(lang);
      expect(g.modules.map((m) => m.id)).toEqual(GUIDE_MODULES.map((m) => m.id));
      for (const [mi, spec] of GUIDE_MODULES.entries()) {
        const mod = g.modules[mi];
        expect(mod.lessons.map((l) => l.id)).toEqual(spec.lessons.map((l) => l.id));
        for (const [li, lspec] of spec.lessons.entries()) {
          const lesson = mod.lessons[li];
          expect(lesson.title.length).toBeGreaterThan(0);
          expect(lesson.what.length).toBeGreaterThan(0);
          expect((lesson.examples ?? []).length).toBe((lspec.routes ?? []).length);
          // Steps: same count in every language.
          const esLesson = guideOf("es").modules[mi].lessons[li];
          expect((lesson.steps ?? []).length).toBe((esLesson.steps ?? []).length);
        }
      }
      expect(g.onboarding.s2Examples.length).toBe(ONBOARDING_ROUTES.length);
    });
  }
});

describe("user guide — every example does what the guide promises", () => {
  for (const lang of ["es", "en", "pt"] as Lang[]) {
    const g = guideOf(lang);
    const cases: Array<[string, string, GuideRoute]> = [];
    for (const [mi, spec] of GUIDE_MODULES.entries()) {
      for (const [li, lspec] of spec.lessons.entries()) {
        const examples = g.modules[mi].lessons[li].examples ?? [];
        examples.forEach((ex, i) => cases.push([`${spec.id}.${lspec.id}`, ex, lspec.routes![i]]));
      }
    }
    g.onboarding.s2Examples.forEach((ex, i) => cases.push(["onboarding", ex, ONBOARDING_ROUTES[i]]));

    it.each(cases)(`${lang} %s: %p → %s`, (_lesson, example, expected) => {
      expect(routeOf(example, lang)).toBe(expected);
    });
  }
});

describe("user guide — nested labels exist", () => {
  const get = (obj: unknown, path: string): unknown =>
    path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
  for (const lang of ["es", "en", "pt"] as Lang[]) {
    it(`${lang}: every $t(...) in the guide resolves to a string`, () => {
      const text = JSON.stringify(guideOf(lang));
      const keys = [...text.matchAll(/\$t\(([^)]+)\)/g)].map((m) => m[1]);
      expect(keys.length).toBeGreaterThan(10);
      for (const k of keys) expect(typeof get(LOCALES[lang], k), k).toBe("string");
    });
  }
});
