/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * confirmText.ts — NIDO: texto del diálogo de confirmación de la política.
 *
 * TOOLS-AUDIT 2026-10-11: el diálogo que pide confirmar una llamada o un SMS
 * decía, en inglés, "Tool 'place_call' is irreversible and requires human
 * confirmation. Riesgo: critical" — sin el número ni el texto. Un
 * consentimiento que no dice QUÉ se va a hacer no es informado. Aquí se
 * construye un texto claro, en el idioma del usuario, con los datos exactos
 * que el despachador va a ejecutar (los mismos args validados).
 *
 * Puro, sin dependencias.
 */

import type { PolicyDecision } from "./policyEngine";

export type ConfirmLang = "es" | "en" | "pt";

export interface ConfirmDialogText {
  title: string;
  message: string;
}

const T = {
  callTitle: { es: "Llamar", en: "Call", pt: "Ligar" },
  callMessage: {
    es: "¿Abrir el marcador para llamar a {{phone}}?\n\nLa llamada no empieza hasta que pulses llamar.",
    en: "Open the dialer to call {{phone}}?\n\nThe call won't start until you tap call.",
    pt: "Abrir o discador para ligar para {{phone}}?\n\nA ligação só começa quando você tocar em ligar.",
  },
  smsTitle: { es: "Enviar SMS", en: "Send SMS", pt: "Enviar SMS" },
  smsMessage: {
    es: "¿Abrir Mensajes para {{phone}} con este texto?\n\n«{{message}}»\n\nNo se envía hasta que tú lo envíes.",
    en: "Open Messages for {{phone}} with this text?\n\n“{{message}}”\n\nNothing is sent until you send it.",
    pt: "Abrir Mensagens para {{phone}} com este texto?\n\n“{{message}}”\n\nNada é enviado até você enviar.",
  },
  saveTitle: { es: "Confirmar guardado", en: "Confirm save", pt: "Confirmar salvamento" },
  saveMessage: {
    es: "En esta conversación hay contenido externo (un mensaje, archivo o nota). Revisa lo que se va a guardar:\n\n«{{content}}»",
    en: "This conversation includes outside content (a message, file or note). Check what will be saved:\n\n“{{content}}”",
    pt: "Esta conversa inclui conteúdo externo (uma mensagem, arquivo ou nota). Confira o que será salvo:\n\n“{{content}}”",
  },
  genericTitle: { es: "Confirmar acción", en: "Confirm action", pt: "Confirmar ação" },
  genericMessage: {
    es: "NIDO va a usar «{{tool}}». Esta acción necesita tu confirmación.",
    en: "NIDO is about to use “{{tool}}”. This action needs your confirmation.",
    pt: "NIDO vai usar “{{tool}}”. Esta ação precisa da sua confirmação.",
  },
  riskCritical: {
    es: "No se puede deshacer.",
    en: "This can't be undone.",
    pt: "Isso não pode ser desfeito.",
  },
} as const;

function fill(s: string, vars: Record<string, string>): string {
  let out = s;
  for (const [k, v] of Object.entries(vars)) out = out.split(`{{${k}}}`).join(v);
  return out;
}

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

export function describePolicyConfirmation(
  decision: Pick<PolicyDecision, "risk" | "reason">,
  action: { tool: string; args: Record<string, unknown> } | undefined,
  lang: ConfirmLang = "es",
): ConfirmDialogText {
  const tool = action?.tool ?? "";
  const args = action?.args ?? {};
  if (tool === "place_call") {
    return {
      title: T.callTitle[lang],
      message: fill(T.callMessage[lang], { phone: str(args.phone) }),
    };
  }
  if (tool === "send_sms") {
    return {
      title: T.smsTitle[lang],
      // El texto COMPLETO, sin recortar (mismo principio que N2 en
      // nido_send_message: el usuario aprueba los bytes exactos).
      message: fill(T.smsMessage[lang], { phone: str(args.phone), message: str(args.message) }),
    };
  }
  if (tool === "remember_fact" || tool === "save_note" || tool === "create_reminder") {
    const content =
      tool === "save_note"
        ? [str(args.title), str(args.body)].filter(Boolean).join(" — ")
        : tool === "create_reminder"
          ? [str(args.text), str(args.at)].filter(Boolean).join(" — ")
          : str(args.content);
    return { title: T.saveTitle[lang], message: fill(T.saveMessage[lang], { content }) };
  }
  const base = fill(T.genericMessage[lang], { tool: tool || "?" });
  return {
    title: T.genericTitle[lang],
    message: decision.risk === "critical" ? `${base} ${T.riskCritical[lang]}` : base,
  };
}
