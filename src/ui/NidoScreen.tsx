/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  FlatList,
  TextInput,
  ActivityIndicator,
  Modal,
  Keyboard,
} from "react-native";
import { showSecureAlert } from "nido-secure-dialog";
import * as Clipboard from "expo-clipboard";
import QRCode from "qrcode";
import { useTranslation } from "react-i18next";
import { useTheme } from "./theme";
import type { Colors } from "./theme/colors";
import { typography } from "./theme/typography";
import { NidoIcon } from "./components/icons/NidoIcon";
import { NidoMascot } from "./components/calm/NidoMascot";
import { calmSpacing, calmRadii, calmShadows } from "./theme/calm";
// F-3 (2026-09-28): N3-style synchronous in-flight guard, now applied to
// NidoScreen's send AND retry gesture paths (state-based `sending` let a
// second tap through before the re-render).
import { SendGuard } from "./sendGuard";
import { NegotiationsTab } from "./NegotiationsTab";
import { PacksTab } from "./PacksTab";

const ERROR_RED = "#F87171";
import { impact, ImpactFeedbackStyle } from "../services/haptics";
import { getSharedNidoMessenger } from "../services/nidoMessenger";
import {
  listContacts,
  findContactRowAny,
  getConversation,
  deleteMessage,
  P2PIdentityKeyLossError,
  type P2PContact,
  type P2PStoredMessage,
} from "../p2p/store";
import { DEDUP_RETENTION_DAYS } from "../p2p/messenger";
import {
  runPairingCeremony,
  type PairingCollisionCandidate,
  type PairingDisambiguationChoice,
} from "../p2p/pairingCeremony";
import {
  buildP2PIdentityRecoveryViewModel,
  routeIdentityBootstrapError,
} from "./p2pIdentityRecovery";
/** BUG-6-2026-10-07: extraer MAC de alias "nombre (MAC)" para deduplicar. */
import { extractMac } from "../p2p/nativeTransport";

type Tab = "chats" | "contactos" | "enlace" | "negociaciones" | "packs";

/** QR dibujado con Views (qrcode es JS puro: sin dependencias nativas). */
function QrGrid({ text, size = 216 }: { text: string; size?: number }) {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const modules = useMemo(() => {
    try {
      const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
      const n = qr.modules.size as number;
      const data = qr.modules.data as Uint8Array | number[];
      return { n, data };
    } catch {
      return null;
    }
  }, [text]);
  if (!modules) return null;
  const cell = size / modules.n;
  const rows: React.ReactNode[] = [];
  for (let r = 0; r < modules.n; r++) {
    const cells: React.ReactNode[] = [];
    for (let c = 0; c < modules.n; c++) {
      const dark = modules.data[r * modules.n + c] === 1;
      cells.push(
        <View
          key={c}
          style={{ width: cell, height: cell, backgroundColor: dark ? "#111" : "#fff" }}
        />,
      );
    }
    rows.push(
      <View key={r} style={{ flexDirection: "row" }}>
        {cells}
      </View>,
    );
  }
  return (
    <View style={[styles.qrBox, { width: size + 24, height: size + 24 }]}>
      <View style={{ width: size, height: size }}>{rows}</View>
    </View>
  );
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function NidoScreen({ onClose }: { onClose: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const { t } = useTranslation();
  const mRef = useRef(getSharedNidoMessenger());
  const [tab, setTab] = useState<Tab>("chats");
  const [myCode, setMyCode] = useState("");
  const [fingerprint, setFingerprint] = useState("");
  // H4-2026-10-06: error visible si la identidad falla por algo que no sea
  // pérdida de claves (antes: spinner eterno con myCode === "").
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [contacts, setContacts] = useState<P2PContact[]>([]);
  /** Ref a contactos vigentes (para onPeerLost sin dependencia circular). */
  const contactsRef = useRef<P2PContact[]>([]);
  useEffect(() => {
    contactsRef.current = contacts;
  }, [contacts]);
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [nearby, setNearby] = useState<string[]>([]);
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  // DIAG-2026-10-07: estado del servidor RFCOMM nativo (¿el accept loop está
  // vivo?). Se sondea mientras la pantalla está abierta; es una llamada
  // nativa síncrona barata.
  const [serverStatus, setServerStatus] = useState<{
    alive: boolean;
    acceptedCount: number;
    lastAcceptAt: number;
  } | null>(null);
  const [peer, setPeer] = useState<P2PContact | null>(null);
  const [messages, setMessages] = useState<P2PStoredMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  /**
   * AUTO-RECONNECT 2026-10-07: cuando se pierde un peer emparejado, reintentar
   * automáticamente con backoff exponencial (5s, 10s, 20s, 40s, 60s; máx 5
   * intentos). Usa handleConnectPaired (que ya prueba bonded MACs primero).
   * Se cancela si el usuario conecta manualmente o sale de la pantalla.
   */
  const reconnectRef = useRef<Map<string, { attempts: number; timer: ReturnType<typeof setTimeout> | undefined }>>(new Map());
  const cancelReconnect = useCallback((pkHex: string) => {
    const key = pkHex.toLowerCase();
    const entry = reconnectRef.current.get(key);
    if (entry) {
      if (entry.timer) clearTimeout(entry.timer);
      reconnectRef.current.delete(key);
    }
  }, []);
  /** Ref al handleConnectPaired vigente (evita dependencia circular con onPeerLost). */
  const connectPairedRef = useRef<(pkHex: string, name: string) => Promise<boolean>>(async () => false);
  /**
   * AUTO-RECONNECT 2026-10-07: programa un reintento de conexión con backoff
   * exponencial. Se usa cuando onPeerLost detecta que un contacto emparejado
   * se desconectó.
   */
  const scheduleReconnect = useCallback((pkHex: string, name: string) => {
    const key = pkHex.toLowerCase();
    const existing = reconnectRef.current.get(key);
    // No duplicar: si ya hay un timer activo, no hacer nada.
    if (existing?.timer) return;
    const attempts = existing?.attempts ?? 0;
    if (attempts >= 5) {
      reconnectRef.current.delete(key);
      return;
    }
    // Backoff: 5s, 10s, 20s, 40s, 60s (tope).
    const delayMs = Math.min(5000 * 2 ** attempts, 60000);
    const timer = setTimeout(() => {
      // Marcar timer como inactivo pero MANTENER attempts para el backoff.
      const e = reconnectRef.current.get(key);
      if (e) e.timer = undefined;
      // FIX 2026-10-07: handleConnectPaired ahora devuelve boolean.
      // Si devuelve false (falló), programar el siguiente intento.
      void connectPairedRef.current(pkHex, name).then((ok) => {
        if (!ok) scheduleReconnect(pkHex, name);
      }).catch(() => {
        scheduleReconnect(pkHex, name);
      });
    }, delayMs);
    reconnectRef.current.set(key, { attempts: attempts + 1, timer });
  }, []);
  const [pairText, setPairText] = useState("");
  const [pairBusy, setPairBusy] = useState(false);
  const [pairError, setPairError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * UI-2026-10-07: altura del teclado para que no tape el composer en la
   * vista de conversación. Mismo patrón que ChatScreen (keyboardDidShow/
   * keyboardDidHide → paddingBottom).
   */
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    const showSub = Keyboard.addListener("keyboardDidShow", (e) => {
      setKeyboardHeight(e.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener("keyboardDidHide", () => {
      setKeyboardHeight(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);
  // UNIT B (R2): modal de desambiguación de emparejamiento (Replace /
  // Different person / Cancel). Dismiss = cancel. El rename para
  // "different_person" debe ser único entre los contactos vivos antes de
  // permitir confirmar.
  const [disamb, setDisamb] = useState<{
    collision: PairingCollisionCandidate[];
    newFingerprint: string;
    newName: string;
    liveNames: string[];
  } | null>(null);
  const [disambName, setDisambName] = useState("");
  const disambResolveRef = useRef<((c: PairingDisambiguationChoice) => void) | null>(null);
  // F-2: pérdida de claves de identidad P2P. Falla cerrado: la pantalla de
  // recovery honesto bloquea la UI hasta que el usuario confirma el
  // recovery o cierra. Nunca se regenera la identidad en silencio.
  const [identityKeyLoss, setIdentityKeyLoss] = useState<P2PIdentityKeyLossError | null>(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  // F-2: tras un recovery exitoso hay que reactivar el enlace (el efecto
  // del enlace ya falló una vez con P2PIdentityKeyLossError).
  const [linkAttempt, setLinkAttempt] = useState(0);
  const peerRef = useRef<P2PContact | null>(null);
  peerRef.current = peer;
  const listRef = useRef<FlatList<P2PStoredMessage>>(null);
  // F-3: synchronous gesture guards — separate refs for send and retry so a
  // send and a retry can interleave, but a double-tap on either collapses
  // to a single logical send/new message_id.
  const sendGuardRef = useRef<SendGuard>(new SendGuard());
  const retryGuardRef = useRef<SendGuard>(new SendGuard());

  const loadContacts = useCallback(async () => {
    try {
      setContacts(await listContacts());
    } catch {
      /* noop */
    }
  }, []);

  const loadConversation = useCallback(async (pkHex: string) => {
    try {
      setMessages(await getConversation(pkHex));
    } catch {
      /* noop */
    }
  }, []);

  // Identidad + código de emparejamiento (una vez).
  // H4: extraído a función para permitir reintento desde la UI.
  const bootstrapIdentity = useCallback(async () => {
    setIdentityError(null);
    try {
      const m = mRef.current;
      const id = await m.ensureIdentity();
      setFingerprint(id.fingerprint);
      setMyCode(await m.myPairingCode());
      await loadContacts();
      // Wire negotiationService send function to the shared messenger.
      // This enables Accept/Decline/Counter to send signed responses to peers.
      const { negotiationService } = await import("../p2p/negotiationService");
      negotiationService.setLocalIdentity(id.pkHex);
      negotiationService.setSendFunction(
        (peerPkHex, action, negotiationId, signed) =>
          m.sendNegotiationResponse(peerPkHex, action, negotiationId, signed)
      );
    } catch (e) {
      // F-2: pérdida de claves de identidad → recovery honesto, no
      // first-run falso ni regeneración silenciosa.
      if (routeIdentityBootstrapError(e) === "p2p-identity-loss") {
        setIdentityKeyLoss(e as P2PIdentityKeyLossError);
      } else {
        // H4-2026-10-06: cualquier otro error → estado visible con reintento,
        // no spinner eterno.
        setIdentityError(e instanceof Error ? e.message : String(e));
      }
    }
  }, [loadContacts]);

  useEffect(() => {
    void bootstrapIdentity();
  }, [bootstrapIdentity]);

  // Enlace P2P activo mientras la pantalla está abierta.
  useEffect(() => {
    let cancelled = false;
    const m = mRef.current;
    (async () => {
      try {
        await m.startLink({
          onPeerFound: (p) => {
            if (cancelled) return;
            if (p.pkHex) {
              setOnline((prev) => new Set(prev).add(p.pkHex.toLowerCase()));
              // Refresca el alias si el dispositivo anuncia otro nombre.
              setContacts((prev) =>
                prev.map((c) =>
                  c.pkHex.toLowerCase() === p.pkHex.toLowerCase() && p.alias !== c.name
                    ? { ...c, name: p.alias }
                    : c,
                ),
              );
            } else {
              setNearby((prev) => (prev.includes(p.alias) ? prev : [...prev, p.alias]));
            }
          },
          onPeerLost: (pkHex) => {
            if (cancelled) return;
            setOnline((prev) => {
              const next = new Set(prev);
              next.delete(pkHex.toLowerCase());
              return next;
            });
            setNearby((prev) => prev.filter((a) => a !== pkHex));
            // AUTO-RECONNECT 2026-10-07: si el peer perdido es un contacto
            // emparejado, programar reconexión automática con backoff.
            // (El nombre se busca en contactos; si no está, no se reintenta.)
            const contact = contactsRef.current.find(
              (c) => c.pkHex.toLowerCase() === pkHex.toLowerCase(),
            );
            if (contact) {
              scheduleReconnect(pkHex, contact.name);
            }
          },
          onError: (msg) => {
            if (!cancelled) setLinkError(msg);
          },
        });
        if (!cancelled) {
          setLinking(true);
          setLinkError(null);
        }
      } catch (e) {
        if (!cancelled) {
          // F-2: la pérdida de identidad se routea a la pantalla de
          // recovery honesto, no a un error genérico del enlace.
          if (routeIdentityBootstrapError(e) === "p2p-identity-loss") {
            setIdentityKeyLoss(e as P2PIdentityKeyLossError);
          } else {
            setLinkError(e instanceof Error ? e.message : String(e));
          }
        }
      }
    })();
    return () => {
      cancelled = true;
      void m.stopLink().catch(() => {});
    };
  }, [linkAttempt, scheduleReconnect]);

  // DIAG-2026-10-07: sondeo del estado del servidor RFCOMM nativo mientras
  // la pantalla está abierta. Responde la pregunta decisiva del diagnóstico
  // P2P: ¿el accept loop está vivo? (La notificación del foreground service
  // NO lo garantiza.)
  useEffect(() => {
    const m = mRef.current;
    const poll = () => {
      try {
        setServerStatus(m.serverStatus());
      } catch {
        setServerStatus(null);
      }
    };
    poll();
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, []);

  // Refresco de la conversación abierta: polling local barato. El messenger
  // guarda los frames entrantes al recibirlos; el polling los pinta.
  useEffect(() => {
    if (!peer) return;
    void loadConversation(peer.pkHex);
    const id = setInterval(() => void loadConversation(peer.pkHex), 4000);
    return () => clearInterval(id);
  }, [peer, loadConversation]);

  // Los frames entrantes refrescan la conversación vía polling (ver efecto
  // de arriba): el messenger persiste cada frame al recibirlo.

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || !peer) return;
    // F-3: synchronous in-flight guard, N3 protocol verbatim. The old
    // closure-captured `sending` state was batched, so two taps in the same
    // tick both saw `sending === false` and both persisted a message. The
    // ref is set synchronously here, before any await, so the second tap
    // observes the first and bails out. Release in the outer finally: every
    // exit path (early returns, errors) passes through it.
    if (!sendGuardRef.current.tryAcquire()) return;
    setSending(true);
    try {
      const res = await mRef.current.sendChat(peer.name, text);
      setDraft("");
      setNotice(res.queued ? t("nido.queuedNotice") : t("nido.sentNotice"));
      await loadConversation(peer.pkHex);
    } catch (e) {
      setNotice(`${t("nido.errorLabel")}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSending(false);
      sendGuardRef.current.release();
    }
  }, [draft, peer, loadConversation]);

  /**
   * N6 §10 + UNIT B (§7): reintento explícito desde 'failed'.
   * retryOutboundMessage decide de forma autoritativa (gate SQL):
   * - éxito dentro del horizonte: mismo message_id; más allá: id fresco;
   * - peer_superseded → rechazado: se ofrece reenviar como mensaje NUEVO
   *   a la identidad viva (resendToSupersedingIdentity), con confirmación
   *   explícita; la fila vieja jamás se muta;
   * - orphaned_destination → rechazado honesto (R3);
   * - user_cancelled → rechazado: solo una confirmación explícita NUEVA
   *   lo reenvía, siempre con message_id fresco (R4).
   */
  const handleRetry = useCallback(
    async (item: P2PStoredMessage) => {
      if (!peer) return;
      // F-3: same N3 protocol on the retry gesture. Two rapid taps on
      // "Retry"/"Send again" must not issue two concurrent
      // retryOutboundMessage() calls (beyond horizon that would mint two
      // fresh ids; within horizon it is benign but still one gesture).
      if (!retryGuardRef.current.tryAcquire()) return;
      impact(ImpactFeedbackStyle.Light);
      try {
        const res = await mRef.current.retryOutboundMessage(item.id);
        if (!res) {
          setNotice(`${t("nido.errorLabel")}: ${item.id}`);
        } else if ("refused" in res) {
          // UNIT B (§7): rechazo tipado con la causa — mensaje honesto y,
          // donde aplica, el gesto explícito que sí está permitido.
          if (res.refused === "peer_superseded") {
            const successorName = res.supersededBy
              ? ((await mRef.current.contacts()).find(
                  (c) => c.pkHex.toLowerCase() === res.supersededBy!.toLowerCase(),
                )?.name ?? null)
              : null;
            if (res.supersededBy && successorName) {
              // Gesto explícito nuevo: reenviar como mensaje NUEVO a la
              // identidad viva (la fila vieja queda failed para siempre).
              const ok = await showSecureAlert({
                title: t("nido.resendToSuccessorTitle"),
                message: t("nido.resendToSuccessorMessage", { name: successorName }),
                cancelLabel: t("common.cancel"),
                confirmLabel: t("nido.sendAgainAction"),
                cancelable: true,
              });
              if (ok) {
                const r2 = await mRef.current.resendToSupersedingIdentity(item.id);
                setNotice(
                  "id" in r2
                    ? t("nido.resentToSuccessorNotice")
                    : `${t("nido.errorLabel")}: ${item.id}`,
                );
              } else {
                setNotice(t("nido.retryRefusedSuperseded"));
              }
            } else {
              setNotice(t("nido.retryRefusedSuperseded"));
            }
          } else if (res.refused === "orphaned_destination") {
            setNotice(t("nido.retryRefusedOrphaned"));
          } else {
            // user_cancelled: la cancelación es terminal para la intención;
            // solo una confirmación explícita NUEVA reenvía (R4: siempre
            // con message_id fresco).
            const ok = await showSecureAlert({
              title: t("nido.resendCancelledTitle"),
              message: t("nido.resendCancelledMessage"),
              cancelLabel: t("common.cancel"),
              confirmLabel: t("nido.sendAgainAction"),
              cancelable: true,
            });
            if (ok) {
              const r2 = await mRef.current.retryOutboundMessage(item.id, {
                explicitGesture: true,
              });
              setNotice(
                r2 && !("refused" in r2)
                  ? t("nido.sendAgainNotice")
                  : `${t("nido.errorLabel")}: ${item.id}`,
              );
            } else {
              setNotice(t("nido.retryRefusedUserCancelled"));
            }
          }
        } else {
          setNotice(t(res.freshId ? "nido.sendAgainNotice" : "nido.retryNotice"));
        }
        await loadConversation(peer.pkHex);
      } catch (e) {
        setNotice(`${t("nido.errorLabel")}: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        retryGuardRef.current.release();
      }
    },
    [peer, loadConversation, t],
  );

  /**
   * DELETE-MSG 2026-10-07: borra un mensaje del chat P2P (solo local).
   * Se invoca con long-press sobre la burbuja; pide confirmación.
   */
  const handleDeleteMessage = useCallback(
    async (item: P2PStoredMessage) => {
      if (!peer) return;
      const ok = await showSecureAlert({
        title: t("nido.deleteMessageTitle"),
        message: t("nido.deleteMessageConfirm"),
        cancelLabel: t("common.cancel"),
        confirmLabel: t("common.delete"),
        cancelable: true,
      });
      if (!ok) return;
      try {
        await deleteMessage(item.id);
        setMessages((prev) => prev.filter((m) => m.id !== item.id));
      } catch (e) {
        setNotice(`${t("nido.errorLabel")}: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [peer, t],
  );

  const handlePair = useCallback(async () => {
    const text = pairText.trim();
    if (!text || pairBusy) return;
    setPairBusy(true);
    setPairError(null);
    try {
      // B/F3 + UNIT B (R2): ceremonia de emparejamiento — la misma política
      // que el path del agente: decodificar+validar primero, mostrar huella
      // y advertencias de ligadura, exigir confirmación explícita, y solo
      // entonces emparejar. Sin confirmación no se escribe nada.
      // UNIT B: si el QR colisiona en nombre con otra identidad viva, se
      // presenta la desambiguación (Replace / Different person / Cancel)
      // en un modal propio; dismiss = cancel.
      const m = mRef.current;
      const outcome = await runPairingCeremony(text, {
        t: (key, opts) => t(key, opts),
        listContacts: () => m.contacts(),
        // UNIT B (§10 Q10): nota "la identidad volvió" si la pk escaneada
        // fue retirada antes.
        findContactAny: async (pkHex) => {
          const row = await findContactRowAny(pkHex);
          return row ? { name: row.name, supersededBy: row.supersededBy } : null;
        },
        selfPkHex: async () => (await m.ensureIdentity()).pkHex,
        // R3: ceremonia de emparejamiento con diálogo FLAG_SECURE en la
        // propia ventana del Dialog (el flag de MainActivity no cubre
        // Dialog windows). Fallo del diálogo → fail closed: no emparejar.
        requestConfirm: (title, message) =>
          showSecureAlert({
            title,
            message,
            cancelLabel: t("common.cancel"),
            confirmLabel: t("common.confirm"),
            cancelable: true,
          }),
        chooseDisambiguation: (collision, newFingerprint, newName) =>
          new Promise<PairingDisambiguationChoice>((resolve) => {
            disambResolveRef.current = (c) => {
              setDisamb(null);
              setDisambName("");
              resolve(c);
            };
            setDisambName("");
            // Nombres vivos para validar el rename único en el modal.
            void m.contacts().then(
              (live) => {
                setDisamb({
                  collision,
                  newFingerprint,
                  newName,
                  liveNames: live.map((c) => c.name),
                });
              },
              () => {
                setDisamb({ collision, newFingerprint, newName, liveNames: [] });
              },
            );
          }),
        pairNow: (choice) =>
          m.pairWith(
            text,
            choice
              ? {
                  disambiguation: choice.choice,
                  newName: choice.newName,
                  replaceTargets: choice.replaceTargets,
                }
              : undefined,
          ),
      });
      if (outcome.status === "paired") {
        setPairText("");
        setNotice(t("nido.pairedNotice", { name: outcome.name }));
        await loadContacts();
      } else {
        // "cancelled": el usuario decidió no emparejar — nada se escribió.
        setNotice(t("nido.pairCancelledNotice"));
      }
    } catch (e) {
      setPairError(e instanceof Error ? e.message : String(e));
    } finally {
      setPairBusy(false);
    }
  }, [pairText, pairBusy, loadContacts, t]);

  const handleConnect = useCallback(
    async (alias: string) => {
      if (connecting) return;
      setConnecting(alias);
      setLinkError(null);
      try {
        const info = await mRef.current.connectPeer(alias);
        setNotice(t("nido.connectedNotice", { alias }));
        setNearby((prev) => prev.filter((a) => a !== alias));
        await loadContacts();
      } catch (e) {
        setLinkError(e instanceof Error ? e.message : String(e));
      } finally {
        setConnecting(null);
      }
    },
    [connecting, loadContacts],
  );

  /**
   * BUG-5-2026-10-06: conectar a un contacto paired probando las MACs
   * descubiertas. El pairing QR intercambia pk pero el discovery BT solo
   * da MACs; sin esto el usuario no sabe qué MAC tocar entre ~20.
   * Prueba cada nearby hasta que el handshake devuelva el pk esperado.
   */
  const handleConnectPaired = useCallback(
    async (pkHex: string, name: string): Promise<boolean> => {
      if (connecting) return false;
      const target = pkHex.toLowerCase();
      setConnecting(`paired:${target}`);
      setLinkError(null);
      try {
        // BRIAR-2026-10-06: rol de dial determinístico. Solo el lado con el
        // pkHex menor inicia la conexión; el otro solo escucha. Esto elimina
        // la colisión de dial simultáneo en la fuente (ambas tablets tocando
        // Connect al mismo tiempo creaba carreras de sockets RFCOMM).
        const shouldDial = await mRef.current.shouldDialPeer(target);
        if (!shouldDial) {
          // Soy el listener: no barro, solo espero. El servidor ya está
          // corriendo (startLink al abrir la pantalla P2P).
          setNotice(t("nido.waitingForPeer", { name }));
          return true;
        }
        const candidates = await (async () => {
          // BUG-6-2026-10-07: el barrido solo probaba MACs descubiertas, pero
          // la app nunca pide visibilidad Bluetooth, así que la tablet peer
          // jamás aparecía en "nearby" y el barrido probaba ~20 aparatos
          // ajenos sin llegar nunca a la receptora (silencio total en ella).
          // Las tablets sí están emparejadas a nivel OS, así que las MACs
          // emparejadas van PRIMERO (no requieren discovery) y las nearby
          // después, deduplicadas por MAC.
          //
          // BUG-6 Plan B (2026-10-07): las MACs conocidas de handshakes previos
          // van ANTES que las bonded. Si getBondedDevices() sale vacía/stale,
          // el barrido aún encuentra al peer por su MAC guardada.
          const knownFirst: string[] = [];
          try {
            const { getKnownMacs } = await import("../p2p/store");
            const known = await getKnownMacs();
            for (const mac of known.values()) knownFirst.push(mac);
          } catch {
            /* best-effort */
          }
          const bonded: string[] = [];
          try {
            const bondedMacs = await mRef.current.getBondedMacs();
            for (const m of bondedMacs) bonded.push(m);
          } catch {
            /* best-effort: seguir solo con nearby */
          }
          const seen = new Set<string>();
          const out: string[] = [];
          for (const m of knownFirst) {
            const up = m.toUpperCase();
            if (!seen.has(up)) { seen.add(up); out.push(up); }
          }
          for (const m of bonded) {
            const up = m.toUpperCase();
            if (!seen.has(up)) { seen.add(up); out.push(m); }
          }
          for (const alias of nearby) {
            const mac = extractMac(alias)?.toUpperCase();
            if (mac && !seen.has(mac)) {
              seen.add(mac);
              out.push(alias);
            } else if (!mac) {
              out.push(alias);
            }
          }
          return out;
        })();
        if (candidates.length === 0) {
          throw new Error(t("nido.noNearbyForPaired"));
        }
        // P2P-2026-10-06: jitter aleatorio 0-2s antes del barrido para evitar
        // choque simultáneo si ambas tablets tocan Connect al mismo tiempo.
        // El research mostró que el dial simultáneo crea condiciones de carrera
        // en los sockets que rompen el handshake.
        await new Promise((r) => setTimeout(r, Math.random() * 2000));
        let lastError: string = "";
        for (let i = 0; i < candidates.length; i++) {
          const alias = candidates[i];
          // P2P-2026-10-06: pausa entre intentos. El research mostró que el
          // socket anterior necesita ~500ms para cerrarse del todo antes de
          // intentar el siguiente, o el connect falla con "read failed".
          if (i > 0) {
            await new Promise((r) => setTimeout(r, 750));
          }
          try {
            const info = await mRef.current.connectPeer(alias);
            if (info.pkHex.toLowerCase() === target) {
              // AUTO-RECONNECT 2026-10-07: conexión exitosa, cancelar reintentos.
              cancelReconnect(target);
              setNotice(t("nido.connectedNotice", { alias: name }));
              setNearby((prev) => prev.filter((a) => a !== alias));
              await loadContacts();
              return true;
            }
            // Handshake OK pero es otro peer: desconectar y seguir con el siguiente.
            // BUG-5-2026-10-06: antes no se desconectaba, dejando conexiones basura abiertas.
            await mRef.current.disconnectPeer(info.pkHex).catch(() => {});
          } catch (e) {
            lastError = e instanceof Error ? e.message : String(e);
            // Seguir con la siguiente MAC.
          }
        }
        throw new Error(
          lastError || t("nido.pairedNotFound", { name })
        );
      } catch (e) {
        setLinkError(e instanceof Error ? e.message : String(e));
        // FIX 2026-10-07: devolver false en vez de tragar el error.
        // El auto-reconnect necesita saber si falló para reintentar.
        return false;
      } finally {
        setConnecting(null);
      }
    },
    [connecting, loadContacts, nearby, t],
  );
  // Mantener el ref actualizado para auto-reconnect.
  useEffect(() => {
    connectPairedRef.current = handleConnectPaired;
  }, [handleConnectPaired]);
  // Cancelar todos los reintentos al desmontar.
  useEffect(() => {
    return () => {
      for (const [, entry] of reconnectRef.current) {
        if (entry.timer) clearTimeout(entry.timer);
      }
      reconnectRef.current.clear();
    };
  }, []);

  const copy = useCallback(
    async (value: string, label: string) => {
      await Clipboard.setStringAsync(value);
      setNotice(t("nido.copiedNotice", { label }));
    },
    [t],
  );

  const openChat = useCallback(
    (c: P2PContact) => {
      impact(ImpactFeedbackStyle.Light);
      setPeer(c);
      setNotice(null);
      void loadConversation(c.pkHex);
    },
    [loadConversation],
  );

  /**
   * N6 §10: estados visibles por mensaje saliente. Exactamente cuatro.
   * 'sent' usa un glyph NEUTRO (reloj) y NUNCA un checkmark: significa
   * "salió al stack local, confirmación del otro NIDO pendiente". El PRIMER
   * y ÚNICO checkmark inequívoco de éxito pertenece a 'delivered'.
   */
  const outStatusSuffix = useCallback(
    (item: P2PStoredMessage): string => {
      switch (item.status) {
        case "queued":
          return t("nido.queuedSuffix");
        case "sent":
          return t("nido.sentSuffix");
        case "delivered":
          return t("nido.deliveredSuffix");
        case "failed":
          return t("nido.failedSuffix");
        default:
          return "";
      }
    },
    [t],
  );

  const renderMessage = useCallback(({ item }: { item: P2PStoredMessage }) => {
    const out = item.dir === "out";
    // N6 §10: 'failed' lleva acción explícita de reintento. La etiqueta
    // distingue el caso dentro del horizonte ("Retry": mismo mensaje) del
    // caso más allá del horizonte ("Send again": envío nuevo con id fresco,
    // §7). La decisión autoritativa la toma retryOutboundMessage al pulsar.
    const showRetry = out && item.status === "failed";
    const beyondHorizon = showRetry && Date.now() - item.ts > DEDUP_RETENTION_DAYS * 86_400_000;
    // DELETE-MSG 2026-10-07: long-press sobre la burbuja para borrar (solo local).
    return (
      <Pressable
        onLongPress={() => void handleDeleteMessage(item)}
        delayLongPress={500}
        style={[styles.bubble, out ? styles.bubbleOut : styles.bubbleIn]}
      >
        <Text style={[styles.bubbleText, out && styles.bubbleTextOut]}>{item.text}</Text>
        <Text style={[styles.bubbleMeta, out && styles.bubbleMetaOut]}>
          {fmtTime(item.ts)}
          {out ? outStatusSuffix(item) : ""}
        </Text>
        {showRetry ? (
          <Pressable
            onPress={() => void handleRetry(item)}
            hitSlop={8}
            style={styles.retryAction}
            accessibilityRole="button"
            accessibilityLabel={t(beyondHorizon ? "nido.sendAgainAction" : "nido.retryAction")}
          >
            <Text style={styles.retryActionText}>
              {t(beyondHorizon ? "nido.sendAgainAction" : "nido.retryAction")}
            </Text>
          </Pressable>
        ) : null}
      </Pressable>
    );
  }, [t, outStatusSuffix, handleRetry, handleDeleteMessage]);

  // ── F-2: recovery honesto de identidad P2P ─────────────────────────
  // Doble confirmación explícita con showSecureAlert (misma ceremonia que
  // el emparejamiento); solo entonces recoverP2PIdentityAfterKeyLoss(true).
  // No hay auto-regeneración en ningún otro camino.
  const handleIdentityRecovery = useCallback(async () => {
    if (recoveryBusy || !identityKeyLoss) return;
    try {
      const first = await showSecureAlert({
        title: t("p2pIdentityRecovery.confirmTitle"),
        message: t("p2pIdentityRecovery.confirmBody"),
        cancelLabel: t("p2pIdentityRecovery.cancel"),
        confirmLabel: t("common.confirm"),
        cancelable: true,
      });
      if (!first) return;
      const second = await showSecureAlert({
        title: t("p2pIdentityRecovery.secondTitle"),
        message: t("p2pIdentityRecovery.secondBody"),
        cancelLabel: t("p2pIdentityRecovery.cancel"),
        confirmLabel: t("common.confirm"),
        cancelable: true,
      });
      if (!second) return;
      setRecoveryBusy(true);
      const m = mRef.current;
      await m.recoverP2PIdentityAfterKeyLoss(true);
      setIdentityKeyLoss(null);
      setLinkError(null);
      const id = await m.ensureIdentity();
      setFingerprint(id.fingerprint);
      setMyCode(await m.myPairingCode());
      await loadContacts();
      setNotice(t("p2pIdentityRecovery.recovered"));
      // El efecto del enlace ya falló con la identidad vieja: reactivarlo
      // con la identidad nueva.
      setLinkAttempt((a) => a + 1);
    } catch (e) {
      setLinkError(e instanceof Error ? e.message : String(e));
    } finally {
      setRecoveryBusy(false);
    }
  }, [recoveryBusy, identityKeyLoss, loadContacts, t]);

  // ── F-2: la pérdida de identidad bloquea la UI hasta el recovery ──────
  // El usuario debe leer el copy honesto y decidir: nada se envía, nada se
  // empareja y nada se regenera hasta que confirma explícitamente (o cierra).
  if (identityKeyLoss) {
    const vm = buildP2PIdentityRecoveryViewModel(identityKeyLoss);
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <NidoIcon name="warning" size={20} />
            <Text style={styles.title}>{t(vm.copy.title)}</Text>
          </View>
          <Pressable
            onPress={() => {
              impact(ImpactFeedbackStyle.Light);
              onClose();
            }}
            hitSlop={8}
            style={styles.closeBtn}
            accessibilityRole="button"
            accessibilityLabel={t("common.done")}
          >
            <Text style={styles.closeBtnText}>{t("common.done")}</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.keyLossBody}>
          <Text style={styles.keyLossTitle}>{t(vm.copy.title)}</Text>
          <Text style={styles.keyLossText}>{t(vm.copy.whatHappened)}</Text>
          <Text style={styles.keyLossText}>{t(vm.copy.consequence)}</Text>
          <Text style={styles.keyLossText}>{t(vm.copy.archived)}</Text>
          <Text style={styles.keyLossMeta}>
            {t(vm.copy.lostIdentityLabel)}: {vm.pkHex.slice(0, 16)}…
          </Text>
          <Pressable
            onPress={() => void handleIdentityRecovery()}
            disabled={recoveryBusy}
            style={[styles.keyLossButton, recoveryBusy && styles.keyLossButtonDisabled]}
            accessibilityRole="button"
            accessibilityLabel={t(vm.copy.recoverButton)}
          >
            {recoveryBusy ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.keyLossButtonText}>{t(vm.copy.recoverButton)}</Text>
            )}
          </Pressable>
          {recoveryBusy ? <Text style={styles.keyLossText}>{t(vm.copy.recovering)}</Text> : null}
        </ScrollView>
      </View>
    );
  }

  // ── Vista de conversación ──────────────────────────────────────────
  if (peer) {
    const isOnline = online.has(peer.pkHex.toLowerCase());
    return (
      <View style={[styles.container, { paddingBottom: keyboardHeight }]}>
        <View style={styles.header}>
          <Pressable
            onPress={() => setPeer(null)}
            hitSlop={8}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel={t("nido.back")}
          >
            <Text style={styles.backBtnText}>{t("nido.back")}</Text>
          </Pressable>
          <View style={styles.peerTitleWrap}>
            <View style={styles.peerTitleRow}>
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: isOnline ? colors.emerald[500] : colors.text.dim },
                ]}
              />
              <Text style={styles.peerName} numberOfLines={1}>
                {peer.name}
              </Text>
            </View>
            <Text style={styles.peerSub}>
              {isOnline ? t("nido.online") : t("nido.offlineQueued")}
            </Text>
          </View>
        </View>
        {notice ? (
          <Text style={styles.notice} onPress={() => setNotice(null)}>
            {notice}
          </Text>
        ) : null}
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={renderMessage}
          contentContainerStyle={styles.chatList}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        />
        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder={t("nido.messagePlaceholder")}
            placeholderTextColor={colors.text.muted}
            multiline
            maxLength={4000}
          />
          <Pressable
            onPress={handleSend}
            disabled={sending || !draft.trim()}
            style={[styles.sendBtn, (!draft.trim() || sending) && styles.sendBtnDisabled]}
            accessibilityRole="button"
            accessibilityLabel={t("nido.sendMessage")}
          >
            {sending ? (
              <ActivityIndicator size="small" color={colors.text.primary} />
            ) : (
              <NidoIcon name="send" size={20} color="#fff" />
            )}
          </Pressable>
        </View>
      </View>
    );
  }

  // ── Vista principal con pestañas ───────────────────────────────────
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <NidoIcon name="pairing" size={20} />
          <Text style={styles.title}>NIDO</Text>
        </View>
        <Pressable
          onPress={() => {
            impact(ImpactFeedbackStyle.Light);
            onClose();
          }}
          hitSlop={8}
          style={styles.closeBtn}
          accessibilityRole="button"
          accessibilityLabel={t("common.done")}
        >
          <Text style={styles.closeBtnText}>{t("common.done")}</Text>
        </Pressable>
      </View>

      <View style={styles.linkBar}>
        {linkError ? (
          <View style={styles.linkErrorRow}>
            <NidoIcon name="warning" size={13} />
            <Text style={styles.linkStatus}>{linkError}</Text>
          </View>
        ) : (
          <Text style={styles.linkStatus}>
            {linking ? t("nido.linkActive") : t("nido.linkStopped")}
          </Text>
        )}
      </View>
      {notice ? (
        <Text style={styles.notice} onPress={() => setNotice(null)}>
          {notice}
        </Text>
      ) : null}

      <View style={styles.tabs}>
        {(
          [
            ["chats", t("nido.tabChats")],
            ["contactos", t("nido.tabContacts")],
            ["enlace", t("nido.tabLink")],
            ["negociaciones", t("nido.tabNegotiations")],
            ["packs", t("nido.tabPacks")],
          ] as Array<[Tab, string]>
        ).map(([key, label]) => (
          <Pressable
            key={key}
            onPress={() => setTab(key)}
            style={[styles.tab, tab === key && styles.tabActive]}
            accessibilityRole="button"
            accessibilityLabel={label}
          >
            <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {tab === "chats" && (
        <ScrollView contentContainerStyle={styles.body}>
          {contacts.length === 0 ? (
            <View style={[styles.card, styles.emptyCard]}>
              <NidoMascot role="guide" size={100} />
              <Text style={styles.cardTitle}>{t("nido.noContactsTitle")}</Text>
              <Text style={styles.paragraph}>{t("nido.noContactsBody")}</Text>
            </View>
          ) : (
            contacts.map((c) => (
              <Pressable
                key={c.pkHex}
                onPress={() => openChat(c)}
                style={styles.contactRow}
                accessibilityRole="button"
                accessibilityLabel={c.name}
              >
                <View
                  style={[
                    styles.statusDot,
                    {
                      backgroundColor: online.has(c.pkHex.toLowerCase())
                        ? colors.emerald[500]
                        : colors.text.dim,
                    },
                  ]}
                />
                <View style={styles.contactInfo}>
                  <Text style={styles.contactName}>{c.name}</Text>
                  <Text style={styles.contactSub}>
                    {online.has(c.pkHex.toLowerCase()) ? t("nido.online") : t("nido.offline")}
                    {c.verified ? t("nido.verifiedSuffix") : ""}
                  </Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            ))
          )}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t("nido.howItWorksTitle")}</Text>
            <Text style={styles.paragraph}>{t("nido.howItWorksBody")}</Text>
          </View>
        </ScrollView>
      )}

      {tab === "contactos" && (
        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t("nido.myCodeTitle")}</Text>
            <Text style={styles.paragraph}>{t("nido.myCodeBody")}</Text>
            {myCode ? (
              <QrGrid text={myCode} />
            ) : identityError ? (
              <View>
                <Text style={styles.paragraph}>{t("nido.identityError", { error: identityError })}</Text>
                <Pressable
                  onPress={() => void bootstrapIdentity()}
                  style={styles.secondaryBtn}
                  accessibilityRole="button"
                  accessibilityLabel={t("common.retry")}
                >
                  <Text>{t("common.retry")}</Text>
                </Pressable>
              </View>
            ) : (
              <ActivityIndicator />
            )}
            <Text style={styles.fingerprint}>{fingerprint}</Text>
            <Pressable
              onPress={() => void copy(myCode, t("nido.codeLabel"))}
              style={styles.secondaryBtn}
            accessibilityRole="button"
            accessibilityLabel={t("nido.copyCode")}
            >
              <Text style={styles.secondaryBtnText}>{t("nido.copyCode")}</Text>
            </Pressable>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t("nido.pairTitle")}</Text>
            <Text style={styles.paragraph}>{t("nido.pairBody")}</Text>
            <TextInput
              style={[styles.input, styles.pairInput]}
              value={pairText}
              onChangeText={(v) => {
                setPairText(v);
                setPairError(null);
              }}
              placeholder={t("nido.pairPlaceholder")}
              placeholderTextColor={colors.text.muted}
              autoCapitalize="none"
              autoCorrect={false}
              multiline
            />
            {pairError ? <Text style={styles.error}>{pairError}</Text> : null}
            <Pressable
              onPress={handlePair}
              disabled={pairBusy || !pairText.trim()}
              style={[styles.primaryBtn, (pairBusy || !pairText.trim()) && styles.btnDisabled]}
            accessibilityRole="button"
            accessibilityLabel={t("nido.pairButton")}
            >
              {pairBusy ? (
                <ActivityIndicator size="small" color={colors.text.primary} />
              ) : (
                <Text style={styles.primaryBtnText}>{t("nido.pairButton")}</Text>
              )}
            </Pressable>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              {t("nido.pairedCount", { count: contacts.length })}
            </Text>
            {contacts.map((c) => {
              const isOnline = online.has(c.pkHex.toLowerCase());
              const isConnectingThis =
                connecting === `paired:${c.pkHex.toLowerCase()}`;
              return (
                <View key={c.pkHex} style={styles.contactRowStatic}>
                  <View
                    style={[
                      styles.statusDot,
                      {
                        backgroundColor: isOnline
                          ? colors.emerald[500]
                          : colors.text.dim,
                      },
                    ]}
                  />
                  <View style={styles.contactInfo}>
                    <Text style={styles.contactName}>{c.name}</Text>
                    <Text style={styles.contactSub} selectable>
                      {c.pkHex.slice(0, 16)}… ·{" "}
                      {isOnline ? t("nido.online") : t("nido.offline")}
                    </Text>
                  </View>
                  {/* BUG-5-2026-10-06: botón para conectar probando MACs */}
                  {!isOnline && (
                    <Pressable
                      onPress={() => void handleConnectPaired(c.pkHex, c.name)}
                      disabled={connecting !== null}
                      style={[
                        styles.smallBtn,
                        connecting !== null && styles.btnDisabled,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={t("nido.connectPaired", {
                        name: c.name,
                      })}
                    >
                      <Text style={styles.smallBtnText}>
                        {isConnectingThis
                          ? t("nido.connecting")
                          : t("nido.connect")}
                      </Text>
                    </Pressable>
                  )}
                </View>
              );
            })}
          </View>
        </ScrollView>
      )}

      {tab === "enlace" && (
        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t("nido.serverTitle")}</Text>
            <Text style={styles.paragraph}>
              {serverStatus === null
                ? t("nido.serverUnknown")
                : serverStatus.alive
                  ? t("nido.serverActive", { count: serverStatus.acceptedCount })
                  : t("nido.serverInactive")}
            </Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t("nido.nearbyTitle")}</Text>
            <Text style={styles.paragraph}>{t("nido.nearbyBody")}</Text>
            {nearby.length === 0 ? (
              <Text style={styles.paragraph}>{t("nido.searching")}</Text>
            ) : (
              nearby.map((alias) => (
                <View key={alias} style={styles.contactRowStatic}>
                  <View style={styles.contactInfo}>
                    <Text style={styles.contactName}>{alias}</Text>
                  </View>
                  <Pressable
                    onPress={() => void handleConnect(alias)}
                    disabled={connecting !== null}
                    style={[styles.smallBtn, connecting !== null && styles.btnDisabled]}
            accessibilityRole="button"
            accessibilityLabel={t("nido.connectButton")}
                  >
                    {connecting === alias ? (
                      <ActivityIndicator size="small" color={colors.text.primary} />
                    ) : (
                      <Text style={styles.smallBtnText}>{t("nido.connectButton")}</Text>
                    )}
                  </Pressable>
                </View>
              ))
            )}
          </View>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t("nido.privacyTitle")}</Text>
            <Text style={styles.paragraph}>{t("nido.privacyBody")}</Text>
          </View>
        </ScrollView>
      )}

      {tab === "negociaciones" && <NegotiationsTab />}
      {tab === "packs" && (
        <PacksTab
          peers={contacts.map((c) => ({ pkHex: c.pkHex, name: c.name }))}
          getPeerName={(pkHex) => {
            const contact = contacts.find((c) => c.pkHex.toLowerCase() === pkHex.toLowerCase());
            return contact?.name ?? pkHex.slice(0, 8);
          }}
        />
      )}

      {/* UNIT B (R2): desambiguación de emparejamiento — Replace /
          Different person / Cancel. Dismiss (backdrop, X, botón atrás) =
          cancel: nada se escribe. */}
      <Modal
        visible={disamb !== null}
        transparent
        animationType="fade"
        onRequestClose={() => disambResolveRef.current?.({ choice: "cancel" })}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => disambResolveRef.current?.({ choice: "cancel" })}
          accessibilityRole="button"
          accessibilityLabel={t("common.cancel")}
        >
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>{t("nido.pairDisambiguationTitle")}</Text>
            {disamb ? (
              <>
                <Text style={styles.paragraph}>
                  {t("nido.pairDisambiguationBody", {
                    name: disamb.newName,
                    fingerprint: disamb.newFingerprint,
                  })}
                </Text>
                {disamb.collision.map((c) => (
                  <Text key={c.pkHex} style={styles.monoLine} selectable>
                    {c.name} · {c.fingerprint}
                  </Text>
                ))}
                {/* Replace: confirmación destructiva explícita. */}
                <Pressable
                  style={[styles.primaryBtn, styles.dangerBtn]}
                  accessibilityRole="button"
                  accessibilityLabel={t("nido.pairReplaceAction")}
                  onPress={() => {
                    void showSecureAlert({
                      title: t("nido.pairReplaceConfirmTitle"),
                      message: t("nido.pairReplaceConfirmMessage"),
                      cancelLabel: t("common.cancel"),
                      confirmLabel: t("nido.pairReplaceAction"),
                      cancelable: true,
                    }).then((ok) => {
                      if (ok) disambResolveRef.current?.({ choice: "replace" });
                    });
                  }}
                >
                  <Text style={styles.primaryBtnText}>{t("nido.pairReplaceAction")}</Text>
                </Pressable>
                {/* Different person: exige rename único antes de confirmar. */}
                <Text style={styles.modalLabel}>{t("nido.pairNewNameLabel")}</Text>
                <TextInput
                  style={styles.input}
                  value={disambName}
                  onChangeText={setDisambName}
                  placeholder={t("nido.pairNewNamePlaceholder")}
                  placeholderTextColor={colors.text.muted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={40}
                />
                {(() => {
                  const trimmed = disambName.trim();
                  const taken =
                    trimmed.length > 0 &&
                    disamb.liveNames.some(
                      (n) =>
                        n.trim().toLowerCase().normalize("NFC") ===
                        trimmed.toLowerCase().normalize("NFC"),
                    );
                  const okName = trimmed.length > 0 && !taken;
                  return (
                    <>
                      {taken ? (
                        <Text style={styles.error}>
                          {t("nido.pairNameTaken", { name: trimmed })}
                        </Text>
                      ) : null}
                      <Pressable
                        style={[styles.secondaryBtn, !okName && styles.btnDisabled]}
                        disabled={!okName}
            accessibilityRole="button"
            accessibilityLabel={t("nido.pairDifferentPersonAction")}
                        onPress={() =>
                          disambResolveRef.current?.({
                            choice: "different_person",
                            newName: trimmed,
                          })
                        }
                      >
                        <Text style={styles.secondaryBtnText}>
                          {t("nido.pairDifferentPersonAction")}
                        </Text>
                      </Pressable>
                    </>
                  );
                })()}
                <Pressable
                  style={styles.modalCancelBtn}
                  onPress={() => disambResolveRef.current?.({ choice: "cancel" })}
                  accessibilityRole="button"
                  accessibilityLabel={t("common.cancel")}
                >
                  <Text style={styles.modalCancelText}>{t("common.cancel")}</Text>
                </Pressable>
              </>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const getStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.surface },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: calmSpacing.comfortable,
    paddingVertical: calmSpacing.cozy,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: calmSpacing.cozy },
  headerIcon: { fontSize: 24 },
  title: { ...typography.ui.titleLg, color: colors.text.primary },
  closeBtn: { padding: calmSpacing.cozy },
  closeBtnText: { ...typography.ui.body, color: colors.emerald[500] },
  backBtn: { padding: calmSpacing.cozy },
  backBtnText: { ...typography.ui.body, color: colors.emerald[500] },
  peerTitleWrap: { flex: 1, alignItems: "center", marginRight: calmSpacing.spacious },
  peerName: { ...typography.ui.titleSm, color: colors.text.primary },
  peerSub: { ...typography.ui.caption, color: colors.text.muted },
  linkBar: {
    paddingHorizontal: calmSpacing.comfortable,
    paddingVertical: calmSpacing.tight,
    backgroundColor: colors.bg.terminal,
  },
  linkStatus: { ...typography.ui.caption, color: colors.text.secondary },
  notice: {
    ...typography.ui.caption,
    color: colors.text.primary,
    backgroundColor: colors.bg.card,
    paddingHorizontal: calmSpacing.comfortable,
    paddingVertical: calmSpacing.cozy,
  },
  tabs: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
  },
  tab: { flex: 1, paddingVertical: calmSpacing.cozy, alignItems: "center" },
  tabActive: { borderBottomWidth: 2, borderBottomColor: colors.emerald[500] },
  tabText: { ...typography.ui.body, color: colors.text.muted },
  tabTextActive: { color: colors.text.primary, fontWeight: "600" },
  body: { padding: calmSpacing.comfortable, gap: calmSpacing.comfortable },
  card: {
    ...calmShadows.none,
    backgroundColor: colors.bg.card,
    borderRadius: calmRadii.soft,
    padding: calmSpacing.comfortable,
    gap: calmSpacing.cozy,
    alignItems: "center",
  },
  // Calm Agent: empty state card with mascot, centered content
  emptyCard: {
    paddingVertical: calmSpacing.spacious,
    gap: calmSpacing.comfortable,
  },
  cardTitle: { ...typography.ui.titleSm, color: colors.text.primary, alignSelf: "flex-start" },
  paragraph: { ...typography.ui.body, color: colors.text.secondary, alignSelf: "flex-start" },
  error: { ...typography.ui.body, color: ERROR_RED, alignSelf: "flex-start" },
  qrBox: {
    backgroundColor: "#fff",
    borderRadius: calmRadii.subtle,
    alignItems: "center",
    justifyContent: "center",
    marginVertical: calmSpacing.cozy,
  },
  fingerprint: {
    ...typography.mono.base,
    color: colors.text.primary,
    textAlign: "center",
    letterSpacing: 1,
  },
  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.bg.card,
    borderRadius: calmRadii.soft,
    padding: calmSpacing.comfortable,
    gap: calmSpacing.cozy,
  },
  contactRowStatic: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: calmSpacing.cozy,
    gap: calmSpacing.cozy,
    alignSelf: "stretch",
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  peerTitleRow: { flexDirection: "row", alignItems: "center", gap: 6, justifyContent: "center" },
  linkErrorRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  // F-2: pantalla honesta de pérdida de identidad P2P.
  keyLossBody: { padding: calmSpacing.airy, gap: calmSpacing.comfortable },
  keyLossTitle: { ...typography.ui.titleLg, color: colors.text.primary },
  keyLossText: { ...typography.ui.body, color: colors.text.secondary },
  keyLossMeta: { ...typography.ui.caption, color: colors.text.muted },
  keyLossButton: {
    backgroundColor: colors.emerald[600],
    borderRadius: calmRadii.soft,
    paddingVertical: calmSpacing.comfortable,
    alignItems: "center",
    marginTop: calmSpacing.cozy,
  },
  keyLossButtonDisabled: { opacity: 0.6 },
  keyLossButtonText: { ...typography.ui.body, color: "#fff", fontWeight: "600" },
  contactInfo: { flex: 1 },
  contactName: { ...typography.ui.body, color: colors.text.primary, fontWeight: "600" },
  contactSub: { ...typography.ui.caption, color: colors.text.muted },
  chevron: { fontSize: 20, color: colors.text.muted },
  primaryBtn: {
    backgroundColor: colors.emerald[500],
    borderRadius: calmRadii.soft,
    paddingVertical: calmSpacing.cozy,
    paddingHorizontal: calmSpacing.airy,
    alignItems: "center",
    alignSelf: "stretch",
  },
  primaryBtnText: { ...typography.ui.body, color: colors.text.primary, fontWeight: "600" },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: calmRadii.soft,
    paddingVertical: calmSpacing.cozy,
    paddingHorizontal: calmSpacing.comfortable,
    alignItems: "center",
  },
  secondaryBtnText: { ...typography.ui.body, color: colors.text.secondary },
  smallBtn: {
    backgroundColor: colors.emerald[500],
    borderRadius: calmRadii.subtle,
    paddingVertical: calmSpacing.tight,
    paddingHorizontal: calmSpacing.comfortable,
  },
  smallBtnText: { ...typography.ui.caption, color: colors.text.primary, fontWeight: "600" },
  btnDisabled: { opacity: 0.5 },
  input: {
    ...typography.ui.body,
    color: colors.text.primary,
    backgroundColor: colors.bg.terminal,
    borderRadius: calmRadii.soft,
    paddingHorizontal: calmSpacing.comfortable,
    paddingVertical: calmSpacing.cozy,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  pairInput: { alignSelf: "stretch", minHeight: 80, textAlignVertical: "top" },
  // UNIT B (R2): modal de desambiguación de emparejamiento.
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
    padding: calmSpacing.airy,
  },
  modalCard: {
    ...calmShadows.none,
    backgroundColor: colors.bg.surface,
    borderRadius: calmRadii.gentle,
    padding: calmSpacing.airy,
    gap: calmSpacing.cozy,
    width: "100%",
    maxWidth: 420,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  modalTitle: { ...typography.ui.titleSm, color: colors.text.primary },
  modalLabel: { ...typography.ui.caption, color: colors.text.secondary, marginTop: calmSpacing.tight },
  monoLine: {
    ...typography.ui.caption,
    color: colors.text.muted,
    fontFamily: "monospace",
  },
  dangerBtn: { backgroundColor: ERROR_RED },
  modalCancelBtn: { paddingVertical: calmSpacing.cozy, alignItems: "center" },
  modalCancelText: { ...typography.ui.body, color: colors.text.secondary },
  chatList: { padding: calmSpacing.comfortable, gap: calmSpacing.cozy },
  bubble: {
    maxWidth: "80%",
    borderRadius: calmRadii.soft,
    paddingHorizontal: calmSpacing.comfortable,
    paddingVertical: calmSpacing.cozy,
  },
  bubbleIn: { alignSelf: "flex-start", backgroundColor: colors.bg.card },
  bubbleOut: { alignSelf: "flex-end", backgroundColor: colors.emerald[500] },
  bubbleText: { ...typography.ui.body, color: colors.text.primary },
  bubbleTextOut: { color: "#fff" },
  bubbleMeta: { ...typography.ui.caption, color: colors.text.muted, marginTop: 2, textAlign: "right" },
  bubbleMetaOut: { color: "rgba(255,255,255,0.8)" },
  // N6 §10: acción explícita de reintento en mensajes 'failed'.
  retryAction: {
    marginTop: calmSpacing.tight,
    alignSelf: "flex-end",
    paddingVertical: calmSpacing.tight,
    paddingHorizontal: calmSpacing.cozy,
    borderRadius: calmRadii.pill,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  retryActionText: { ...typography.ui.caption, color: colors.text.primary, fontWeight: "600" },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    padding: calmSpacing.cozy,
    gap: calmSpacing.cozy,
    borderTopWidth: 1,
    borderTopColor: colors.border.subtle,
  },
  sendBtn: {
    backgroundColor: colors.emerald[500],
    borderRadius: calmRadii.pill,
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnText: { color: "#fff", fontSize: 20 },
});
