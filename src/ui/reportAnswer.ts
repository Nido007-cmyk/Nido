/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */
// «Reportar esta respuesta» (Google Play, política de contenido generado
// por IA: el usuario puede señalar una respuesta ofensiva o dañina desde la
// app). NIDO no envía nada: se abre el correo del usuario con un borrador
// que él lee, edita y decide enviar. Puro, sin React, para poder probarlo.

export const REPORT_ADDRESS = "arsrs91@gmail.com";
/** Tope por campo: un enlace mailto demasiado largo no abre en algunos clientes. */
export const REPORT_FIELD_MAX = 1200;

type Lang = "es" | "en" | "pt";

const TEXT: Record<Lang, { subject: string; intro: string; q: string; a: string; why: string; foot: string }> = {
  es: {
    subject: "NIDO: reporte de una respuesta",
    intro: "Revisa este correo antes de enviarlo. Puedes borrar lo que no quieras compartir. NIDO no envía nada por sí solo.",
    q: "Pregunta",
    a: "Respuesta de NIDO",
    why: "Qué está mal (escríbelo aquí)",
    foot: "Versión",
  },
  en: {
    subject: "NIDO: answer report",
    intro: "Review this email before sending it. You can delete anything you don't want to share. NIDO sends nothing on its own.",
    q: "Question",
    a: "NIDO's answer",
    why: "What is wrong (write it here)",
    foot: "Version",
  },
  pt: {
    subject: "NIDO: denúncia de uma resposta",
    intro: "Revise este e-mail antes de enviá-lo. Você pode apagar o que não quiser compartilhar. O NIDO não envia nada sozinho.",
    q: "Pergunta",
    a: "Resposta do NIDO",
    why: "O que está errado (escreva aqui)",
    foot: "Versão",
  },
};

function clip(s: string): string {
  const t = s.trim();
  return t.length <= REPORT_FIELD_MAX ? t : `${t.slice(0, REPORT_FIELD_MAX)}…`;
}

export function langOf(code: string | undefined): Lang {
  const c = (code ?? "").slice(0, 2).toLowerCase();
  return c === "es" || c === "pt" ? c : "en";
}

export function buildAnswerReportMailto(args: {
  question: string | undefined;
  answer: string;
  lang: string | undefined;
  version: string;
}): string {
  const L = TEXT[langOf(args.lang)];
  const body = [
    L.intro,
    "",
    `${L.why}:`,
    "",
    "",
    `${L.q}:`,
    clip(args.question ?? "—"),
    "",
    `${L.a}:`,
    clip(args.answer),
    "",
    `${L.foot}: ${args.version}`,
  ].join("\n");
  return `mailto:${REPORT_ADDRESS}?subject=${encodeURIComponent(L.subject)}&body=${encodeURIComponent(body)}`;
}
