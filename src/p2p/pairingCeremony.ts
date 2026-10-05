/**
 * pairingCeremony.ts — NIDO P2P: ceremonia de emparejamiento compartida (B/F3).
 *
 * El path de UI emparejaba directo (sin mostrar huella ni pedir
 * confirmación) mientras el path del agente (nido_pair) exige la ceremonia
 * completa. Este módulo unifica AMBOS bajo una sola política — no inventa
 * una segunda: ningún peer queda emparejado/verificado sin
 *   1. decodificar y validar el QR/payload primero;
 *   2. mostrar al usuario la identidad/huella del peer;
 *   3. mostrar la advertencia de ligadura/conflicto que aplique (M-5);
 *   4. confirmación humana explícita;
 *   5. y solo entonces la escritura de emparejamiento.
 *
 * La escritura real sigue siendo messenger.pairWith (single write path,
 * con su propia validación + rechazo de self-QR como defensa en
 * profundidad); aquí solo se orquesta la ceremonia.
 * In-person/live-scan: el mensaje de confirmación exige cotejo verbal de
 * la huella en persona, igual que en el path del agente.
 */

import { decodePairingPayload, type PairingPayload } from "./pairing";
import { fingerprint, fromHex } from "./crypto";
import { normalizeContactName } from "./contactName";
import type { PairDisambiguation } from "./messenger";

/** Contacto mínimo necesario para las advertencias M-5. */
export interface PairingContactLike {
  pkHex: string;
  name: string;
}

/** Función i18n inyectada por el llamador (claves agentConfirm.*). */
export type CeremonyT = (key: string, opts?: Record<string, string>) => string;

/**
 * UNIT B (R2): candidatos de desambiguación — contactos VIVOS con el mismo
 * nombre normalizado que el QR pero OTRA pk. Mismo nombre ≠ misma
 * identidad: el usuario debe elegir explícitamente.
 */
export interface PairingCollisionCandidate {
  pkHex: string;
  name: string;
  fingerprint: string;
}

export interface PairingCeremonyPreview {
  payload: PairingPayload;
  /** Huella legible (8 grupos de 4 hex) para cotejo verbal en persona. */
  fingerprint: string;
  /** Advertencias M-5 de ligadura nombre↔identidad ("" si no aplica). */
  warning: string;
  title: string;
  message: string;
  /** UNIT B: null cuando no hay colisión de nombre con otra identidad viva. */
  collision: PairingCollisionCandidate[] | null;
}

/**
 * UNIT B (R2): detecta la colisión de desambiguación con la MISMA
 * normalización que messenger.pairWith. Devuelve los contactos vivos con
 * el mismo nombre normalizado y pk distinta, o null si no hay colisión.
 * Solo contactos vivos entran: una identidad superseded está muerta y no
 * puede colisionar (el emparejamiento sobre una pk superseded es
 * "la identidad volvió", no una colisión).
 */
export async function findPairingCollision(
  pkHex: string,
  name: string,
  listContacts: () => Promise<readonly PairingContactLike[]>,
): Promise<PairingCollisionCandidate[] | null> {
  // Best-effort como pairingBindingWarning: si los contactos no se pueden
  // consultar, no se afirma colisión; messenger.pairWith es el gate
  // autoritativo y fallará cerrado si la hay.
  let contacts: readonly PairingContactLike[];
  try {
    contacts = await listContacts();
  } catch {
    return null;
  }
  const needle = normalizeContactName(name);
  const pk = pkHex.toLowerCase();
  const hits = contacts.filter(
    (c) => normalizeContactName(c.name) === needle && c.pkHex.toLowerCase() !== pk,
  );
  if (hits.length === 0) return null;
  return hits.map((c) => ({
    pkHex: c.pkHex,
    name: c.name,
    fingerprint: fingerprint(fromHex(c.pkHex)),
  }));
}

/**
 * M-5: advertencia de ligadura nombre↔identidad antes de pedir
 * confirmación. Detecta:
 * - la identidad ya está emparejada (mismo pk, mismo u otro nombre);
 * - el nombre ya existe con OTRA identidad (posible suplantación o cambio
 *   legítimo de dispositivo del contacto: el usuario debe decidir en
 *   persona).
 * Best-effort: si los contactos no se pueden consultar, no se añade
 * advertencia; el emparejamiento sigue exigiendo confirmación explícita
 * con nombre + huella.
 */
export async function pairingBindingWarning(
  t: CeremonyT,
  pkHex: string,
  name: string,
  listContacts: () => Promise<readonly PairingContactLike[]>,
): Promise<string> {
  try {
    const contacts = await listContacts();
    const pk = pkHex.toLowerCase();
    const samePk = contacts.filter((c) => c.pkHex.toLowerCase() === pk);
    // UNIT B: misma normalización que messenger.pairWith (normalizeContactName)
    // — si el nombre coincide aquí, pairWith exige desambiguación explícita
    // o falla las filas queued/sent de la identidad anterior como
    // failed(identity_changed). El usuario debe ver la advertencia ANTES de
    // confirmar.
    const needle = normalizeContactName(name);
    const sameNameOtherPk = contacts.filter(
      (c) =>
        normalizeContactName(c.name) === needle && c.pkHex.toLowerCase() !== pk,
    );
    const notes: string[] = [];
    if (samePk.length > 0) {
      const known = samePk[0].name;
      notes.push(
        known === name
          ? t("agentConfirm.pairBindingKnownSameName", { known })
          : t("agentConfirm.pairBindingKnownOtherName", { known, name }),
      );
    }
    if (sameNameOtherPk.length > 0) {
      notes.push(t("agentConfirm.pairBindingNameConflict", { name }));
    }
    return notes.join("\n");
  } catch {
    return "";
  }
}

/**
 * Pasos 1-3 de la ceremonia: decodifica y valida el código SIN emparejar.
 * Lanza si el payload es inválido (mismo error que decodePairingPayload)
 * o si es el propio QR (no tiene sentido emparejarse con uno mismo).
 * Devuelve el contenido exacto a mostrar en el diálogo de confirmación,
 * más la colisión de desambiguación UNIT B (null si no aplica).
 */
export async function previewPairingCeremony(
  code: string,
  opts: {
    t: CeremonyT;
    listContacts: () => Promise<readonly PairingContactLike[]>;
    /** pkHex de la identidad local; null si aún no existe. */
    selfPkHex: string | null;
    /** UNIT B (§10 Q10): fila sin filtro de ciclo de vida (opcional). */
    findContactAny?: (pkHex: string) => Promise<{ name: string; supersededBy: string | null } | null>;
  },
): Promise<PairingCeremonyPreview> {
  const payload = decodePairingPayload(code);
  if (
    opts.selfPkHex &&
    payload.pk.toLowerCase() === opts.selfPkHex.toLowerCase()
  ) {
    throw new Error("Ese es tu propio QR.");
  }
  const fp = fingerprint(fromHex(payload.pk));
  const warning = await pairingBindingWarning(
    opts.t,
    payload.pk,
    payload.name,
    opts.listContacts,
  );
  // UNIT B (§10 Q10): la pk escaneada fue retirada antes — la ceremonia lo
  // dice explícitamente ("la identidad volvió"), no lo esconde.
  let revivalNote = "";
  if (opts.findContactAny) {
    try {
      const any = await opts.findContactAny(payload.pk);
      if (any && any.supersededBy) {
        revivalNote = opts.t("agentConfirm.pairBindingWasRetired", { name: any.name });
      }
    } catch {
      revivalNote = ""; // best-effort: sin la nota, la ceremonia sigue segura
    }
  }
  const fullWarning = [warning, revivalNote].filter(Boolean).join("\n");
  const collision = await findPairingCollision(payload.pk, payload.name, opts.listContacts);
  const title = opts.t("agentConfirm.pairTitle");
  const message =
    opts.t("agentConfirm.pairMessage", {
      name: payload.name,
      fingerprint: fp,
    }) + (fullWarning ? `\n\n${fullWarning}` : "");
  return { payload, fingerprint: fp, warning: fullWarning, title, message, collision };
}

/**
 * UNIT B (R2): elección de desambiguación recogida por la UI ante una
 * colisión de nombre. Dismiss (o lanzar) se interpreta como "cancel".
 */
export interface PairingDisambiguationChoice {
  choice: PairDisambiguation;
  /**
   * Requerido con "different_person": nombre ÚNICO para el contacto nuevo
   * (la UI lo exige antes de permitir confirmar; el messenger lo valida
   * en defensa en profundidad).
   */
  newName?: string;
  /**
   * UNIT B concurrency closure: pks viejas EXACTAS que la ceremonia mostró
   * al usuario (huella + nombre) y que el usuario confirmó retirar con
   * "replace". Fija el supersede-set por PK, no por nombre: si alguna ya
   * no está viva al confirmar, el emparejamiento falla cerrado en vez de
   * retirar en silencio otra identidad con el mismo nombre.
   */
  replaceTargets?: string[];
}

export interface PairingCeremonyDeps {
  t: CeremonyT;
  listContacts: () => Promise<readonly PairingContactLike[]>;
  /** pkHex de la identidad local; null si aún no existe. */
  selfPkHex: () => Promise<string | null>;
  /**
   * Diálogo nativo de confirmación (solo cuando NO hay colisión).
   * Debe resolver true solo con confirmación explícita; lanzar o
   * resolver false → fail closed (no se empareja).
   */
  requestConfirm: (title: string, message: string) => Promise<boolean>;
  /**
   * UNIT B: se invoca SOLO cuando hay colisión de nombre con otra
   * identidad viva. Debe presentar las tres opciones (Replace /
   * Different person / Cancel) con las huellas vieja y nueva, exigir
   * rename único para "different_person", y resolver la elección.
   * Dismiss o lanzar → "cancel" (fail closed). Si no se provee y hay
   * colisión → cancel (fail closed: jamás se asume Replace).
   */
  chooseDisambiguation?: (
    collision: PairingCollisionCandidate[],
    newFingerprint: string,
    newName: string,
  ) => Promise<PairingDisambiguationChoice>;
  /**
   * UNIT B (§10 Q10): lectura de la fila de contacto SIN filtro de ciclo
   * de vida, para detectar que la pk escaneada fue retirada antes
   * (superseded) y avisar "la identidad volvió" en el diálogo. Opcional:
   * sin ella no hay nota de restauración, pero la ceremonia sigue siendo
   * segura (el aviso es informativo, no un gate).
   */
  findContactAny?: (pkHex: string) => Promise<{ name: string; supersededBy: string | null } | null>;
  /**
   * La escritura de emparejamiento real (p. ej. messenger.pairWith).
   * Recibe la elección cuando hubo colisión. Devuelve null si la
   * elección fue "cancel" (nada escrito).
   */
  pairNow: (choice?: PairingDisambiguationChoice) => Promise<{ name: string } | null>;
}

export type PairingCeremonyOutcome =
  | { status: "paired"; name: string }
  | { status: "cancelled" };

/**
 * Orquesta la ceremonia completa con la invariante B/F3: ningún peer queda
 * emparejado/verificado sin confirmación explícita posterior a mostrar
 * huella + advertencias. Lanza en payload inválido o self-QR; el usuario
 * puede cancelar sin que nada se escriba; un fallo del diálogo se trata
 * como cancelación (fail closed: no se empareja).
 *
 * UNIT B (R2): con colisión de nombre, la UI presenta las tres opciones
 * vía chooseDisambiguation. Sin chooseDisambiguation, o ante dismiss, la
 * colisión cancela (fail closed: jamás se asume Replace).
 */
export async function runPairingCeremony(
  code: string,
  deps: PairingCeremonyDeps,
): Promise<PairingCeremonyOutcome> {
  const preview = await previewPairingCeremony(code, {
    t: deps.t,
    listContacts: deps.listContacts,
    selfPkHex: await deps.selfPkHex(),
    findContactAny: deps.findContactAny,
  });
  let choice: PairingDisambiguationChoice | undefined;
  if (preview.collision) {
    // UNIT B: colisión → desambiguación explícita o cancel.
    if (!deps.chooseDisambiguation) return { status: "cancelled" };
    try {
      choice = await deps.chooseDisambiguation(
        preview.collision,
        preview.fingerprint,
        preview.payload.name,
      );
    } catch {
      choice = undefined; // dismiss/lanzar = cancel
    }
    if (!choice || choice.choice === "cancel") return { status: "cancelled" };
    if (choice.choice !== "replace" && choice.choice !== "different_person") {
      return { status: "cancelled" }; // valor inesperado → fail closed
    }
    // UNIT B concurrency closure: fija por PK las identidades que el
    // usuario vio y confirmó retirar. El messenger valida que sigan vivas;
    // si alguna murió entre la ceremonia y el commit, falla cerrado.
    if (choice.choice === "replace" && preview.collision) {
      choice = { ...choice, replaceTargets: preview.collision.map((c) => c.pkHex) };
    }
  } else {
    let ok = false;
    try {
      ok = await deps.requestConfirm(preview.title, preview.message);
    } catch {
      ok = false; // fallo del diálogo → fail closed: no emparejar
    }
    if (!ok) return { status: "cancelled" };
  }
  const contact = await deps.pairNow(choice);
  if (!contact) return { status: "cancelled" };
  return { status: "paired", name: contact.name };
}
