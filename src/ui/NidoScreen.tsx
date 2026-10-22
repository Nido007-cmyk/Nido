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
  ActivityIndicator,
  Modal,
  Keyboard,
  AppState,
} from "react-native";
import { PrivateTextInput as TextInput } from "./components/PrivateTextInput";
import { showSecureAlert } from "nido-secure-dialog";
import { copyPrivate } from "../utils/secretClipboard";
import QRCode from "qrcode";
import { useTranslation } from "react-i18next";
import { useTheme } from "./theme";
import type { Colors } from "./theme/colors";
import type { Typography } from "./theme/typography";
import { NidoIcon } from "./components/icons/NidoIcon";
import { NidoMascot } from "./components/calm/NidoMascot";
import { calmSpacing, calmRadii, calmShadows } from "./theme/calm";
// F-3 (2026-09-28): N3-style synchronous in-flight guard, now applied to
// NidoScreen's send AND retry gesture paths (state-based `sending` let a
// second tap through before the re-render).
import { SendGuard } from "./sendGuard";
import { NegotiationsTab } from "./NegotiationsTab";
import { reconnectManager } from "../p2p/reconnectManager";
import { PacksTab } from "./PacksTab";
import { RemoteTasksCard } from "./RemoteTasksCard";
import { dismissBatteryHint, openBatterySettings, shouldShowBatteryHint } from "../p2p/batteryHint";

const ERROR_RED = "#F87171";
import { impact, ImpactFeedbackStyle } from "../services/haptics";
import { getSharedNidoMessenger } from "../services/nidoMessenger";
import {
  listContacts,
  findContactRowAny,
  getConversation,
  deleteMessage,
  DISAPPEAR_OPTIONS_SEC,
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
import { extractLanAddress, extractMac } from "../p2p/nativeTransport";
import { describeP2PError } from "../p2p/p2pErrorText";

type Tab = "chats" | "contactos" | "enlace" | "negociaciones" | "packs";

/** QR dibujado con Views (qrcode es JS puro: sin dependencias nativas). */
function QrGrid({ text, size = 216 }: { text: string; size?: number }) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => getStyles(colors, typography), [colors, typography]);
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

/**
 * DIAL-ROLE-2026-10-11: cuánto espera la tablet que "escucha" a que la otra
 * llame antes de llamar ella misma al tocar Conectar.
 */
const LISTENER_WAIT_MS = 8000;
/** Tope de espera si el otro ya está llamando (handshake a medias). */
const LISTENER_MAX_WAIT_MS = 30000;

/** WIFI-UX-2026-10-11: espera máxima a que aparezca el anuncio Wi-Fi del otro. */
const LAN_DISCOVERY_WAIT_MS = 6000;

export function NidoScreen({
  onClose,
  panicSlot,
}: {
  onClose: () => void;
  /** 0.1.46: botón de pánico (solo si el usuario lo activó). */
  panicSlot?: React.ReactNode;
}) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => getStyles(colors, typography), [colors, typography]);
  const { t } = useTranslation();
  // Final audit (0.1.17): P2P errors in plain words and in the app language
  // (they used to show the transport's technical Spanish as is).
  const p2pErr = (e: unknown): string => {
    const d = describeP2PError(e);
    return t(d.key, d.vars ?? {});
  };
  // Errores que ESTA pantalla ya construyó con t(): se muestran tal cual,
  // sin pasar por el mapeo (que los envolvería en el genérico con el
  // texto localizado como «detalle»). Auditoría 2026-10-12.
  const localizedP2PError = (msg: string): Error => {
    const err = new Error(msg) as Error & { nidoLocalized?: boolean };
    err.nidoLocalized = true;
    return err;
  };
  const mRef = useRef(getSharedNidoMessenger());
  const [tab, setTab] = useState<Tab>("chats");
  const [myCode, setMyCode] = useState("");
  const [fingerprint, setFingerprint] = useState("");
  // H4-2026-10-06: error visible si la identidad falla por algo que no sea
  // pérdida de claves (antes: spinner eterno con myCode === "").
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [contacts, setContacts] = useState<P2PContact[]>([]);
  // 0.1.15: aviso de batería (Android congela NIDO en segundo plano).
  const [batteryHint, setBatteryHint] = useState(false);
  const contactCount = contacts.length;
  useEffect(() => {
    let cancelled = false;
    const check = () => {
      shouldShowBatteryHint(contactCount)
        .then((show) => {
          if (!cancelled) setBatteryHint(show);
        })
        .catch(() => {});
    };
    check();
    // Al volver de los ajustes del sistema, el aviso desaparece si ya se permitió.
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") check();
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [contactCount]);
  /** PKs revocados (para filtrar de la lista de contactos). */
  const [revokedPks, setRevokedPks] = useState<Set<string>>(new Set());
  /**
   * FIX 2026-10-09 (SEC-REVOCATION-FAILCLOSED): salud del almacenamiento
   * de revocaciones. Si es false, el banner de recuperación se muestra
   * y P2P permanece bloqueado hasta recuperación explícita.
   */
  const [revocationStoreHealthy, setRevocationStoreHealthy] = useState<boolean>(true);
  const [revocationRecovering, setRevocationRecovering] = useState<boolean>(false);
  /** Ref a contactos vigentes (para onPeerLost sin dependencia circular). */
  const contactsRef = useRef<P2PContact[]>([]);
  useEffect(() => {
    contactsRef.current = contacts;
  }, [contacts]);
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [nearby, setNearby] = useState<string[]>([]);
  // WIFI-UX-2026-10-11: lectura viva de "nearby" dentro de bucles async
  // (el estado capturado por el callback queda congelado).
  const nearbyRef = useRef<string[]>([]);
  useEffect(() => {
    nearbyRef.current = nearby;
  }, [nearby]);
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
  // 0.1.46: temporizador de mensajes temporales del chat abierto, selector
  // y si la sesión con este contacto va en v5.
  const [disappearSec, setDisappearSec] = useState(0);
  const [showTimerPicker, setShowTimerPicker] = useState(false);
  const [sessionV5, setSessionV5] = useState(false);
  const [v5Warning, setV5Warning] = useState(false);
  const [messages, setMessages] = useState<P2PStoredMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  /**
   * AUTO-RECONNECT 2026-10-08 (Option A): retry state machine moved to
   * src/p2p/reconnectManager.ts (module singleton). It survives screen
   * navigation and screen-off; no unmount cleanup here on purpose.
   * Cancel on manual connect success or via reconnectManager.cancelAll().
   */
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

  const loadContacts = useCallback(async () => {    try {
      const list = await listContacts();
      setContacts(list);
      // FIX 2026-10-09: filtrar revocados de la vista.
      const revoked = new Set<string>();
      for (const c of list) {
        try {
          if (await mRef.current.isRevoked(c.pkHex)) {
            revoked.add(c.pkHex.toLowerCase());
          }
        } catch {
          /* noop */
        }
      }
      setRevokedPks(revoked);
      // FIX 2026-10-09 (SEC-REVOCATION-FAILCLOSED): verificar salud del
      // almacenamiento de revocaciones para mostrar banner si está corrupto.
      try {
        const status = await mRef.current.getRevocationStoreStatus();
        setRevocationStoreHealthy(status.healthy);
      } catch {
        // Si no se puede verificar, asumir sano (el transporte hace fail-closed
        // por su cuenta en establishRoute).
      }
    } catch {
      /* noop */
    }
  }, []);

  const loadConversation = useCallback(async (pkHex: string) => {
    try {
      // 0.1.46: mostrar la conversación arranca la cuenta atrás de los
      // mensajes temporales recibidos (como Signal: al verlos). Solo con la
      // app en primer plano: el refresco periódico sigue en segundo plano y
      // ahí nadie está mirando.
      if (AppState.currentState === "active") {
        await mRef.current.markConversationSeen(pkHex).catch(() => 0);
      }
      setMessages(await getConversation(pkHex));
      // Temporizador (puede haberlo adoptado de un mensaje del contacto) y
      // si la sesión va en v5 (clave por mensaje + ML-KEM).
      setDisappearSec(await mRef.current.getDisappearingTimer(pkHex).catch(() => 0));
      setSessionV5(mRef.current.sessionUsesV5(pkHex));
      setV5Warning(await mRef.current.sessionV5Warning(pkHex).catch(() => false));
    } catch (e) {
      // FIX 2026-10-09 (UI-AUDIT/F4): error visible en vez de silencio.
      // Auditoría 2026-10-12: por el mapeo localizado, no el mensaje crudo.
      setNotice(`${t("nido.errorLabel")}: ${p2pErr(e)}`);
    }
  }, [t]);

  /**
   * FIX 2026-10-09 (SEC-REVOCATION-FAILCLOSED): recuperación explícita del
   * almacenamiento de revocaciones corrupto. Requiere confirmación explícita
   * del propietario con advertencia clara de que se perderán las
   * revocaciones anteriores. No restablece confianza automáticamente.
   */
  const handleRevocationStoreRecovery = useCallback(async () => {
    const ok = await showSecureAlert({
      title: t("nido.revocationRecoveryTitle"),
      message: t("nido.revocationRecoveryMessage"),
      cancelLabel: t("common.cancel"),
      confirmLabel: t("nido.revocationRecoveryConfirm"),
      cancelable: true,
    });
    if (!ok) return;
    setRevocationRecovering(true);
    try {
      const recovered = await mRef.current.resetRevocationStore();
      if (recovered) {
        setRevocationStoreHealthy(true);
        setNotice(t("nido.revocationRecoveryDone"));
        // Recargar contactos para reflejar el estado limpio.
        await loadContacts();
      } else {
        setNotice(t("nido.revocationRecoveryFailed"));
      }
    } catch (e) {
      setNotice(`${t("nido.errorLabel")}: ${p2pErr(e)}`);
    } finally {
      setRevocationRecovering(false);
    }
  }, [loadContacts, t]);

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
      // TESTFIX-2026-10-08: isOutgoing() compara proposerPkHex (clave de
      // firma Ed25519) — sin esto las propuestas propias se veían como
      // entrantes en ambas tablets (evidencia física). Fail-open seguro:
      // si la clave de firma no carga, isOutgoing usa fallback y las
      // propuestas propias se ven como entrantes (comportamiento actual),
      // nunca se acepta nada automáticamente.
      try {
        const { getSigningKeypair } = await import("../p2p/store");
        const { toHex } = await import("../p2p/crypto");
        const skp = await getSigningKeypair();
        negotiationService.setLocalSigningPk(toHex(skp.publicKey));
      } catch {
        /* noop: isOutgoing degradado, sin cambio de seguridad */
      }
      // TESTFIX-2026-10-08 (Fix 7): wiring de tareas delegadas.
      // Todo gateado por el flag (default OFF): con el flag apagado,
      // delegationService rechaza envíos y descarta mensajes entrantes.
      try {
        const { delegationService } = await import("../agent/delegation/delegationService");
        const { loadFeatureFlags } = await import("../config/featureFlags");
        await loadFeatureFlags();
        delegationService.setSendFunction((peerPkHex, taskType, body) =>
          m.sendDelegationMessage(peerPkHex, taskType, body as unknown as Record<string, unknown>)
        );
        // P7: los tokens de tareas quedan atados a la sesión viva con el peer.
        delegationService.setSessionTagLookup((peerPkHex) => m.getSessionTag(peerPkHex));
        // R5: liveness re-check — la negociación debe seguir ACCEPTED al aprobar.
        delegationService.setNegotiationStateLookup(
          (negotiationId) =>
            negotiationService
              .listSessions()
              .find((s) => s.negotiationId === negotiationId)?.state
        );
        const { llamaEngine } = await import("../inference/LlamaEngine");
        delegationService.setModelInvoke((prompt: string) =>
          llamaEngine.generate({
            prompt,
            nPredict: 256,
            samplingPreset: "factual",
            telemetryContext: { taskType: "delegation" },
          })
        );
      } catch {
        /* noop: delegación no disponible, el resto del P2P no se afecta */
      }
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
        setIdentityError(p2pErr(e));
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
        // FIX 2026-10-09: restaurar el estado "en línea" desde las rutas
        // vivas del transporte ANTES de arrancar discovery. Sin esto, al
        // volver a la pantalla tras navegar, `online` (useState) arranca
        // vacío y la UI muestra "desconectado" aunque el socket siga vivo,
        // lo que provoca intentos de reconexión manual que chocan con la
        // conexión existente (handshake timeout).
        try {
          const live = m.connectedPeers();
          if (!cancelled && live.length > 0) {
            setOnline(new Set(live.map((pk) => pk.toLowerCase())));
          }
        } catch {
          /* best-effort: si falla, el discovery lo repoblará */
        }
        await m.startLink({
          onPeerFound: (p) => {
            if (cancelled) return;
            if (p.pkHex) {
              setOnline((prev) => new Set(prev).add(p.pkHex.toLowerCase()));
              // FIX 2026-10-09 (I1): limpiar el flag de "perdido" al reconectar.
              // Si no, un redescubrimiento posterior dispara un barrido
              // redundante estando ya conectado.
              reconnectManager.notifyPeerFound(p.pkHex, p.alias ?? "");
              // Refresca el alias si el dispositivo anuncia otro nombre.
              setContacts((prev) =>
                prev.map((c) =>
                  c.pkHex.toLowerCase() === p.pkHex.toLowerCase() && p.alias !== c.name
                    ? { ...c, name: p.alias }
                    : c,
                ),
              );
              // REDISCOVERY 2026-10-08: si el peer redescubierto es un
              // contacto emparejado que se había perdido, reiniciar su ciclo
              // de reintentos (el presupuesto se agota mientras su pantalla
              // está apagada; sin esto nada lo reactiva al volver).
              // notifyPeerFound ignora descubrimientos frescos y ciclos
              // activos: nunca auto-conecta por proximidad ni duplica.
              const contact = contactsRef.current.find(
                (c) => c.pkHex.toLowerCase() === p.pkHex.toLowerCase(),
              );
              if (contact) {
                reconnectManager.notifyPeerFound(p.pkHex, contact.name);
              }
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
            // REDISCOVERY 2026-10-08: marcarlo como perdido para que un
            // redescubrimiento posterior pueda reiniciar el ciclo.
            // FIX 2026-10-09 (B1): NO programar aquí. El transporte ya tiene
            // su propio ReconnectManager dirigido por estado
            // (onNativeDisconnected → scheduleReconnect). Dos loops causaban
            // tormentas de HELLO duplicados y contención de radio.
            const contact = contactsRef.current.find(
              (c) => c.pkHex.toLowerCase() === pkHex.toLowerCase(),
            );
            if (contact) {
              reconnectManager.notifyPeerLost(pkHex);
              // reconnectManager.schedule() ELIMINADO — el transporte lo maneja.
            }
          },
          onError: (msg) => {
            if (!cancelled) setLinkError(msg);
          },
          // WIFI-UX-2026-10-11: "Bluetooth apagado, se usa Wi-Fi" es un aviso,
          // no un error: se muestra como nota, no en rojo.
          onInfo: (msg) => {
            if (!cancelled) setNotice(msg);
          },
        });
        if (!cancelled) {
          setLinking(true);
          setLinkError(null);
        }
        // RECONNECT-AFTER-CRASH 2026-10-10: tras un cierre/reinicio de la app
        // el estado de reconexión (en memoria) se pierde. En el primer
        // arranque del enlace de cada proceso, re-marcar a los contactos ya
        // emparejados con los que hubo handshake (MAC persistida). Una vez
        // por proceso, respetando el rol de dial y en segundo plano.
        void (async () => {
          const { getKnownMacs } = await import("../p2p/store");
          const { reconnectKnownContactsOnce } = await import("../p2p/startupReconnect");
          await reconnectKnownContactsOnce({
            getKnownMacs,
            connectedPeers: () => m.connectedPeers(),
            shouldDialPeer: (pk) => m.shouldDialPeer(pk),
            connectPeer: (alias, opts) => m.connectPeer(alias, opts),
            disconnectPeer: (pk) => m.disconnectPeer(pk),
            onReconnected: (pk) => {
              reconnectManager.cancel(pk);
              if (!cancelled) setOnline((prev) => new Set(prev).add(pk));
            },
          });
        })().catch(() => {});
      } catch (e) {
        if (!cancelled) {
          // F-2: la pérdida de identidad se routea a la pantalla de
          // recovery honesto, no a un error genérico del enlace.
          if (routeIdentityBootstrapError(e) === "p2p-identity-loss") {
            setIdentityKeyLoss(e as P2PIdentityKeyLossError);
          } else {
            setLinkError(p2pErr(e));
          }
        }
      }
    })();
    return () => {
      cancelled = true;
      // REDISCOVERY 2026-10-08: NO llamar a reconnectManager.cancelAll()
      // aquí. El manager es un singleton deliberadamente independiente del
      // ciclo de vida de la pantalla (su cabecera lo documenta) y los
      // reintentos están acotados (5 intentos, fail-closed): matar los
      // timers al desmontar la pantalla rompía el auto-reconnect en
      // segundo plano y contradice la arquitectura P2P-ALWAYS-ON
      // (el servidor nativo y su foreground service siguen vivos como
      // Briar aunque esta pantalla se cierre). cancelAll() queda reservado
      // para apagado terminal explícito (logout / Clear All Data).
      // stopLink() solo detiene el discovery; los reintentos pendientes
      // marcan por MAC conocida/bondeada sin necesitar discovery.
      void m.stopLink().catch(() => {});
    };
  }, [linkAttempt]);

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
      setNotice(p2pErr(e));
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
        setNotice(p2pErr(e));
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
        setNotice(`${t("nido.errorLabel")}: ${p2pErr(e)}`);
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
      // CRYPTO-AUDIT-2026-10-11: clave de firma cambiada → aviso fuerte y
      // localizado (nada se guardó).
      const code = (e as { code?: unknown } | null)?.code;
      if (code === "NIDO_PAIR_KEY_CHANGED") {
        setPairError(t("nido.pairKeyChanged", { name: (e as { contactName?: string }).contactName ?? "" }));
      } else {
        setPairError(p2pErr(e));
      }
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
        setLinkError(p2pErr(e));
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
          // Soy el listener: primero espero a que el otro llame (evita el
          // choque de dos llamadas a la vez). DIAL-ROLE-2026-10-11: antes
          // aquí se terminaba y, si el otro no llamaba, tocar Conectar en
          // esta tablet no hacía nada. Ahora, si en unos segundos no llegó
          // su llamada, llamo yo (el desempate de llamadas simultáneas del
          // transporte cubre el caso de que ambos llamen a la vez).
          setNotice(t("nido.waitingForPeer", { name }));
          // Si mientras tanto hay un handshake a medias (el otro ya nos está
          // llamando), se sigue esperando hasta LISTENER_MAX_WAIT_MS: llamar
          // en ese momento provocaría el choque de dos llamadas por Bluetooth.
          const start = Date.now();
          let deadline = start + LISTENER_WAIT_MS;
          while (Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 500));
            let busy = false;
            try {
              busy = mRef.current.handshakeInProgress();
            } catch {
              busy = false;
            }
            if (busy) deadline = Math.max(deadline, Math.min(Date.now() + 2000, start + LISTENER_MAX_WAIT_MS));
            const live = mRef.current.connectedPeers().map((p) => p.toLowerCase());
            if (live.includes(target)) {
              reconnectManager.cancel(target);
              setNotice(t("nido.connectedNotice", { alias: name }));
              await loadContacts();
              return true;
            }
          }
          setNotice(t("nido.dialingInstead", { name }));
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
          // Wi-Fi local PRIMERO: si otro NIDO se anuncia en esta red, probarlo
          // cuesta segundos (TCP), frente al barrido Bluetooth. El handshake
          // verifica la identidad igual; si no es el contacto buscado, se
          // desconecta y se sigue con Bluetooth.
          const out: string[] = nearby.filter((a) => extractLanAddress(a) !== null);
          for (const m of knownFirst) {
            const up = m.toUpperCase();
            if (!seen.has(up)) { seen.add(up); out.push(up); }
          }
          for (const m of bonded) {
            const up = m.toUpperCase();
            if (!seen.has(up)) { seen.add(up); out.push(m); }
          }
          for (const alias of nearby) {
            if (extractLanAddress(alias) !== null) continue; // ya incluido arriba
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
        // P2P-2026-10-06: jitter aleatorio 0-2s antes del barrido para evitar
        // choque simultáneo si ambas tablets tocan Connect al mismo tiempo.
        // El research mostró que el dial simultáneo crea condiciones de carrera
        // en los sockets que rompen el handshake.
        await new Promise((r) => setTimeout(r, Math.random() * 2000));
        let lastError: string = "";
        const attempt = async (alias: string): Promise<boolean> => {
          try {
            // P2P v4: decir a quién buscamos permite el saludo privado.
            const info = await mRef.current.connectPeer(alias, { targetPkHex: target });
            if (info.pkHex.toLowerCase() === target) {
              // AUTO-RECONNECT 2026-10-07: conexión exitosa, cancelar reintentos.
              reconnectManager.cancel(target);
              setNotice(t("nido.connectedNotice", { alias: name }));
              setNearby((prev) => prev.filter((a) => a !== alias));
              await loadContacts();
              return true;
            }
            // Handshake OK pero es otro peer: desconectar y seguir con el siguiente.
            // BUG-5-2026-10-06: antes no se desconectaba, dejando conexiones basura abiertas.
            await mRef.current.disconnectPeer(info.pkHex).catch(() => {});
          } catch (e) {
            lastError = p2pErr(e);
            // Seguir con la siguiente MAC.
          }
          return false;
        };
        for (let i = 0; i < candidates.length; i++) {
          // P2P-2026-10-06: pausa entre intentos. El research mostró que el
          // socket anterior necesita ~500ms para cerrarse del todo antes de
          // intentar el siguiente, o el connect falla con "read failed".
          if (i > 0) {
            await new Promise((r) => setTimeout(r, 750));
          }
          if (await attempt(candidates[i])) return true;
        }
        // WIFI-UX-2026-10-11: el anuncio Wi-Fi del otro NIDO tarda unos
        // segundos en aparecer al abrir la pantalla. Antes, si el primer
        // toque llegaba antes (p. ej. con Bluetooth apagado), fallaba y había
        // que tocar Conectar otra vez. Ahora se espera un poco a que aparezca.
        const tried = new Set(candidates.map((c) => c.toUpperCase()));
        const lanDeadline = Date.now() + LAN_DISCOVERY_WAIT_MS;
        while (Date.now() < lanDeadline) {
          const fresh = nearbyRef.current.filter(
            (a) => extractLanAddress(a) !== null && !tried.has(a.toUpperCase()),
          );
          if (fresh.length === 0) {
            await new Promise((r) => setTimeout(r, 500));
            continue;
          }
          for (const alias of fresh) {
            tried.add(alias.toUpperCase());
            if (await attempt(alias)) return true;
          }
        }
        if (tried.size === 0) throw localizedP2PError(t("nido.noNearbyForPaired"));
        throw lastError
          ? new Error(lastError)
          : localizedP2PError(t("nido.pairedNotFound", { name }));
      } catch (e) {
        setLinkError(
          e instanceof Error && (e as { nidoLocalized?: boolean }).nidoLocalized
            ? e.message
            : p2pErr(e)
        );
        // FIX 2026-10-07: devolver false en vez de tragar el error.
        // El auto-reconnect necesita saber si falló para reintentar.
        return false;
      } finally {
        setConnecting(null);
      }
    },
    [connecting, loadContacts, nearby, t],
  );
  // AUTO-RECONNECT 2026-10-08: registrar el conector vigente en el manager.
  // Sin cleanup al desmontar: los reintentos sobreviven a la navegación.
  useEffect(() => {
    reconnectManager.setConnector(handleConnectPaired);
  }, [handleConnectPaired]);

  const copy = useCallback(
    async (value: string, label: string) => {
      // Blindaje 0.1.44: el código lleva tu nombre y tus claves públicas;
      // se copia marcado como sensible (fuera del historial del teclado).
      await copyPrivate(value);
      setNotice(t("nido.copiedNotice", { label }));
    },
    [t],
  );

  const openChat = useCallback(
    (c: P2PContact) => {
      impact(ImpactFeedbackStyle.Light);
      setPeer(c);
      setNotice(null);
      setShowTimerPicker(false);
      setDisappearSec(0);
      void mRef.current
        .getDisappearingTimer(c.pkHex)
        .then(setDisappearSec)
        .catch(() => {});
      void loadConversation(c.pkHex);
    },
    [loadConversation],
  );

  // 0.1.46: mensajes temporales e indicador v5. El refresco de la
  // conversación (cada 4 s, más abajo) también relee los dos.

  const timerLabel = useCallback(
    (sec: number) => (sec === 0 ? t("nido.disappearOff") : t(`nido.disappear_${sec}`)),
    [t],
  );

  const chooseTimer = useCallback(
    async (sec: number) => {
      if (!peer) return;
      try {
        await mRef.current.setDisappearingTimer(peer.pkHex, sec);
        setDisappearSec(sec);
        setShowTimerPicker(false);
        setNotice(t("nido.disappearSet", { value: timerLabel(sec) }));
      } catch (e) {
        setNotice(`${t("nido.errorLabel")}: ${p2pErr(e)}`);
      }
    },
    [peer, t, timerLabel],
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
      <Pressable accessibilityRole="button"
        onLongPress={() => void handleDeleteMessage(item)}
        delayLongPress={500}
        style={[styles.bubble, out ? styles.bubbleOut : styles.bubbleIn]}
      >
        <Text style={[styles.bubbleText, out && styles.bubbleTextOut]}>{item.text}</Text>
        <Text style={[styles.bubbleMeta, out && styles.bubbleMetaOut]}>
          {fmtTime(item.ts)}
          {out ? outStatusSuffix(item) : ""}
          {item.ttlSec ? ` · ${t("nido.disappearBadge")}` : ""}
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
      setLinkError(p2pErr(e));
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
              <ActivityIndicator size="small" color={colors.text.inverse} />
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
              {isOnline && sessionV5 ? ` · ${t("nido.v5Active")}` : ""}
            </Text>
            {isOnline && v5Warning ? <Text style={styles.v5Warning}>{t("nido.v5Missing")}</Text> : null}
          </View>
          <Pressable
            onPress={() => setShowTimerPicker((v) => !v)}
            hitSlop={8}
            style={styles.timerBtn}
            accessibilityRole="button"
            accessibilityLabel={`${t("nido.disappearTitle")}: ${timerLabel(disappearSec)}`}
          >
            <Text style={styles.timerBtnText}>
              {t("nido.disappearShort", {
                value: disappearSec === 0 ? t("nido.disappearOffShort") : timerLabel(disappearSec),
              })}
            </Text>
          </Pressable>
          {panicSlot}
        </View>
        {showTimerPicker ? (
          <View style={styles.timerPicker}>
            <Text style={styles.timerPickerTitle}>{t("nido.disappearTitle")}</Text>
            <View style={styles.timerChips}>
              {DISAPPEAR_OPTIONS_SEC.map((sec) => (
                <Pressable
                  key={sec}
                  onPress={() => void chooseTimer(sec)}
                  style={[styles.timerChip, sec === disappearSec && styles.timerChipActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: sec === disappearSec }}
                  accessibilityLabel={timerLabel(sec)}
                >
                  <Text style={[styles.timerChipText, sec === disappearSec && styles.timerChipTextActive]}>
                    {timerLabel(sec)}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.timerPickerHint}>{t("nido.disappearHint")}</Text>
          </View>
        ) : null}
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
              <NidoIcon name="send" size={20} color={colors.text.inverse} />
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
        {panicSlot}
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
      {batteryHint ? (
        <View style={styles.batteryHint}>
          <Text style={styles.batteryHintTitle}>{t("nido.batteryHintTitle")}</Text>
          <Text style={styles.batteryHintBody}>{t("nido.batteryHintBody")}</Text>
          <View style={styles.batteryHintRow}>
            <Pressable
              style={styles.batteryHintButton}
              onPress={() => {
                impact(ImpactFeedbackStyle.Light);
                if (!openBatterySettings()) setNotice(t("nido.batteryHintManual"));
              }}
              accessibilityRole="button"
              accessibilityLabel={t("nido.batteryHintAllow")}
            >
              <Text style={styles.batteryHintButtonText}>{t("nido.batteryHintAllow")}</Text>
            </Pressable>
            <Pressable
              style={styles.batteryHintLater}
              onPress={() => {
                setBatteryHint(false);
                dismissBatteryHint().catch(() => {});
              }}
              accessibilityRole="button"
              accessibilityLabel={t("nido.batteryHintLater")}
            >
              <Text style={styles.batteryHintLaterText}>{t("nido.batteryHintLater")}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      {notice ? (
        <Text style={styles.notice} onPress={() => setNotice(null)}>
          {notice}
        </Text>
      ) : null}
      {/* FIX 2026-10-09 (SEC-REVOCATION-FAILCLOSED): banner de recuperación
          cuando el almacenamiento de revocaciones está corrupto. P2P permanece
          bloqueado hasta recuperación explícita del propietario. */}
      {!revocationStoreHealthy ? (
        <View style={styles.revocationAlert}>
          <Text style={styles.revocationAlertTitle}>
            {t("nido.revocationStoreCorruptTitle")}
          </Text>
          <Text style={styles.revocationAlertBody}>
            {t("nido.revocationStoreCorruptBody")}
          </Text>
          <Pressable
            style={styles.revocationAlertButton}
            onPress={handleRevocationStoreRecovery}
            disabled={revocationRecovering}
            accessibilityRole="button"
            accessibilityLabel={t("nido.revocationRecoveryConfirm")}
          >
            <Text style={styles.revocationAlertButtonText}>
              {revocationRecovering
                ? t("nido.revocationRecovering")
                : t("nido.revocationRecoveryConfirm")}
            </Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.tabs}>
        {(
          [
            ["chats", t("nido.tabChats")],
            ["contactos", t("nido.tabContacts")],
            ["enlace", t("nido.tabLink")],
            ["negociaciones", t("nido.tabNegotiations")],
            // F2/U5: la pestaña Packs se oculta hasta que el envío y la
            // recepción estén conectados (hoy el botón no hace nada).
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

      {/* U2: tareas remotas pendientes de decisión, visibles en cualquier pestaña. */}
      <RemoteTasksCard onNotice={setNotice} />

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
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t("nido.troubleshootTitle")}</Text>
            <Text style={styles.paragraph}>{t("nido.troubleshootBody")}</Text>
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
              maxLength={2000}
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
            {contacts
              .filter((c) => !revokedPks.has(c.pkHex.toLowerCase()))
              .map((c) => {
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
                  {/* FIX 2026-10-09 (CR-4): revocar contacto */}
                  <Pressable
                    onPress={async () => {
                      const ok = await showSecureAlert({
                        title: t("nido.revokeTitle", { name: c.name }),
                        message: t("nido.revokeConfirm"),
                        cancelLabel: t("common.cancel"),
                        confirmLabel: t("nido.revoke"),
                        cancelable: true,
                      });
                      if (ok) {
                        try {
                          await mRef.current.revokePeer(c.pkHex);
                          setRevokedPks((prev) => new Set(prev).add(c.pkHex.toLowerCase()));
                          setNotice(t("nido.revoked", { name: c.name }));
                        } catch (e) {
                          setNotice(
                            e instanceof Error ? p2pErr(e) : t("nido.revokeFailed")
                          );
                        }
                      }
                    }}
                    style={[styles.smallBtn, styles.revokeBtn]}
                    accessibilityRole="button"
                    accessibilityLabel={t("nido.revokeContact", { name: c.name })}
                  >
                    <Text style={[styles.smallBtnText, styles.revokeBtnText]}>
                      {t("nido.revoke")}
                    </Text>
                  </Pressable>
                  {/* U4: eliminar el contacto y su conversación. */}
                  <Pressable
                    onPress={async () => {
                      const ok = await showSecureAlert({
                        title: t("nido.deleteContactTitle", { name: c.name }),
                        message: t("nido.deleteContactConfirm"),
                        cancelLabel: t("common.cancel"),
                        confirmLabel: t("common.delete"),
                        cancelable: true,
                      });
                      if (ok) {
                        try {
                          await mRef.current.removeContact(c.pkHex);
                          await loadContacts();
                          setNotice(t("nido.contactDeleted", { name: c.name }));
                        } catch (e) {
                          setNotice(
                            e instanceof Error ? p2pErr(e) : t("nido.deleteContactFailed")
                          );
                        }
                      }
                    }}
                    style={[styles.smallBtn, styles.revokeBtn]}
                    accessibilityRole="button"
                    accessibilityLabel={t("nido.deleteContactLabel", { name: c.name })}
                  >
                    <Text style={[styles.smallBtnText, styles.revokeBtnText]}>
                      {t("common.delete")}
                    </Text>
                  </Pressable>
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
          <Pressable accessibilityRole="button" style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
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

const getStyles = (colors: Colors, typography: Typography) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.black },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: calmSpacing.comfortable,
    paddingVertical: calmSpacing.cozy,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: calmSpacing.cozy },
  headerIcon: { fontSize: 24 },
  title: { ...typography.ui.titleLg, color: colors.text.primary },
  closeBtn: {
    minHeight: 40,
    paddingHorizontal: 16,
    borderRadius: 9999,
    justifyContent: "center",
    backgroundColor: colors.emerald.bgSubtle,
  },
  closeBtnText: { ...typography.ui.caption, color: colors.emerald[600], fontWeight: "700" },
  backBtn: { padding: calmSpacing.cozy },
  backBtnText: { ...typography.ui.body, color: colors.emerald[500] },
  peerTitleWrap: { flex: 1, alignItems: "center", marginRight: calmSpacing.spacious },
  peerName: { ...typography.ui.titleSm, color: colors.text.primary },
  peerSub: { ...typography.ui.caption, color: colors.text.muted },
  v5Warning: { ...typography.ui.caption, color: colors.crimson[500] },
  timerBtn: {
    marginLeft: calmSpacing.tight,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  timerBtnText: { ...typography.ui.caption, color: colors.text.secondary },
  timerPicker: {
    paddingHorizontal: calmSpacing.comfortable,
    paddingVertical: calmSpacing.tight,
    backgroundColor: colors.bg.terminal,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
  },
  timerPickerTitle: { ...typography.ui.caption, color: colors.text.heading, fontWeight: "700" },
  timerChips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginVertical: 8 },
  timerChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  timerChipActive: { backgroundColor: colors.emerald.bgSubtle, borderColor: colors.emerald[500] },
  timerChipText: { ...typography.ui.caption, color: colors.text.secondary },
  timerChipTextActive: { color: colors.text.accentEmerald, fontWeight: "700" },
  timerPickerHint: { ...typography.ui.caption, color: colors.text.muted },
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
  // FIX 2026-10-09 (SEC-REVOCATION-FAILCLOSED): banner de alerta para
  // almacenamiento de revocaciones corrupto.
  batteryHint: {
    backgroundColor: colors.amber.bgSubtle,
    borderLeftWidth: 4,
    borderLeftColor: colors.amber.border,
    paddingHorizontal: calmSpacing.comfortable,
    paddingVertical: calmSpacing.cozy,
    gap: 6,
  },
  batteryHintTitle: { ...typography.ui.body, fontWeight: "700", color: colors.amber[600] },
  batteryHintBody: { ...typography.ui.caption, color: colors.text.secondary },
  batteryHintRow: { flexDirection: "row", gap: 10, alignItems: "center", flexWrap: "wrap" },
  batteryHintButton: {
    backgroundColor: colors.emerald[500],
    paddingHorizontal: calmSpacing.comfortable,
    borderRadius: 9999,
    minHeight: 40,
    justifyContent: "center",
  },
  batteryHintButtonText: { ...typography.ui.caption, fontWeight: "700", color: colors.text.inverse },
  batteryHintLater: { paddingHorizontal: 12, minHeight: 40, justifyContent: "center" },
  batteryHintLaterText: { ...typography.ui.caption, color: colors.text.secondary, fontWeight: "600" },
  revocationAlert: {
    backgroundColor: colors.crimson.bgSubtle,
    borderLeftWidth: 4,
    borderLeftColor: colors.crimson[500],
    paddingHorizontal: calmSpacing.comfortable,
    paddingVertical: calmSpacing.cozy,
    gap: 8,
  },
  revocationAlertTitle: {
    ...typography.ui.body,
    fontWeight: "700",
    color: colors.crimson[600],
  },
  revocationAlertBody: {
    ...typography.ui.caption,
    color: colors.crimson[600],
  },
  revocationAlertButton: {
    backgroundColor: colors.crimson[500],
    paddingHorizontal: calmSpacing.comfortable,
    paddingVertical: calmSpacing.cozy,
    borderRadius: 9999,
    alignItems: "center",
    minHeight: 44,
    justifyContent: "center",
  },
  revocationAlertButtonText: {
    ...typography.ui.body,
    fontWeight: "700",
    color: colors.text.inverse,
  },
  // Rediseño 2026-10-10: control segmentado en vez de subrayado.
  tabs: {
    flexDirection: "row",
    backgroundColor: colors.bg.cardElevated,
    borderRadius: 13,
    padding: 3,
    marginHorizontal: calmSpacing.comfortable,
    marginVertical: calmSpacing.cozy,
  },
  tab: { flex: 1, paddingVertical: calmSpacing.cozy, alignItems: "center", borderRadius: 10 },
  tabActive: { backgroundColor: colors.bg.card, ...calmShadows.whisper },
  tabText: { ...typography.ui.subtext, fontWeight: "600", color: colors.text.secondary },
  tabTextActive: { color: colors.text.primary },
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
  keyLossButtonText: { ...typography.ui.body, color: colors.text.inverse, fontWeight: "600" },
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
  revokeBtn: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: colors.crimson[500],
    marginLeft: calmSpacing.tight,
  },
  revokeBtnText: { color: colors.crimson[500] },
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
    backgroundColor: colors.bg.modalOverlay,
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
    borderRadius: 9999,
    paddingHorizontal: calmSpacing.comfortable,
    paddingVertical: calmSpacing.cozy,
    minHeight: 44,
    justifyContent: "center",
  },
  bubbleIn: { alignSelf: "flex-start", backgroundColor: colors.bg.card },
  bubbleOut: { alignSelf: "flex-end", backgroundColor: colors.emerald[500] },
  bubbleText: { ...typography.ui.body, color: colors.text.primary },
  bubbleTextOut: { color: colors.text.inverse },
  bubbleMeta: { ...typography.ui.caption, color: colors.text.muted, marginTop: 2, textAlign: "right" },
  bubbleMetaOut: { color: colors.text.inverse, opacity: 0.8 },
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
  sendBtnText: { color: colors.text.inverse, fontSize: 20 },
});
