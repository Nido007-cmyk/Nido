/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, Alert, AppState } from "react-native";
import { Pressable } from "./components/Pressable";
import { impact, ImpactFeedbackStyle } from "../services/haptics";
import { useTranslation } from "react-i18next";
import { CatalogModel } from "../models/manifest";
import { computeCompatibilityDetail, residentReleasableBytes, type Compatibility, type CompatibilityDetail } from "../models/compatibility";
import { defaultLlmForRam } from "../models/defaultModel";
import type { LlmMemoryProfile } from "../inference/LlamaEngine";
import { readRamSnapshot, type RamSnapshot } from "../inference/ramBudget";
import { getDeviceTotalRamBytes } from "ram-monitor";
import { useTheme } from "./theme";
import type { Colors } from "./theme/colors";
import type { Typography } from "./theme/typography";
import { NidoIcon } from "./components/icons/NidoIcon";
import { spacing, radii } from "./theme/spacing";
import { getCorpusIndexStatus, onCorpusIndexStatus, type CorpusIndexStatus } from "../rag/corpusIndexStatus";
import type { ModelSpeedSummary } from "../inference/telemetry";
import { displayLang, formatInt } from "../utils/safeFormat";
import { fontFamilies } from "./theme/typography";

function formatMB(bytes: number): string {
  if (bytes <= 0) return "0 MB";
  return bytes >= 1024 * 1024 * 1024
    ? `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
    : `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

function formatSpeed(bytesPerSec: number | undefined, calculating: string): string {
  if (!bytesPerSec || bytesPerSec <= 0) return calculating;
  if (bytesPerSec >= 1024 * 1024) {
    return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
  }
  return `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
}

function formatEta(seconds: number | undefined, calculating: string): string {
  if (seconds == null || seconds <= 0 || !isFinite(seconds)) return calculating;
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.ceil(seconds % 60);
  return `${mins}m ${secs}s`;
}

export interface CatalogRowState {
  present: boolean;
  downloading: boolean;
  progress: number;
  error: string | null;
  bytesWritten?: number;
  bytesExpected?: number;
  speedBytesPerSec?: number;
  etaSeconds?: number;
  /** 0.1.57: older verified pack, still in use; the new version can be downloaded. */
  outdated?: boolean;
  /**
   * 0.1.90 (familia 3): el motivo durable por el que una descarga
   * completada o intentada no cuenta como descargada, ya traducido
   * por la pantalla (installNoticeFor en src/models/installNotice.ts).
   * Se pinta en la tarjeta cuando no hay descarga en curso ni error
   * en memoria (ese tiene preferencia: es el mismo hecho, más fresco).
   */
  statusNotice?: string | null;
  /**
   * 0.1.92: bytes de una descarga en pausa que siguen en el disco. En un
   * modelo en rojo (sin botón de descarga desde la 0.1.90) esa parte no
   * tenía forma de continuarse NI de borrarse: la tarjeta la dice y
   * ofrece borrarla.
   */
  partialBytes?: number | null;
}

interface Props {
  item: CatalogModel;
  row: CatalogRowState | undefined;
  isActive: boolean;
  onDownload: (item: CatalogModel) => void;
  onUse: (item: CatalogModel) => void;
  onRemove: (item: CatalogModel) => void;
  /** 0.1.92: borra la parte descargada de una descarga en pausa (solo se ofrece en rojo). */
  onDiscardPartial?: (item: CatalogModel) => void;
  /** This model is being loaded after "Use" was tapped. */
  activating?: boolean;
  /** Some model is being loaded: Use and delete are unavailable until it finishes. */
  busy?: boolean;
  /**
   * 0.1.108: la carga REALMENTE residente (la pantalla la lee del
   * motor: qué modelo es, su contexto cargado y el perfil de memoria
   * aceptado). En la 0.1.108 solo la tarjeta del residente la
   * recibía y solo ella aplicaba el crédito liberable de la carga.
   * Tanda too-heavy (0.1.115): la pantalla la pasa a TODAS las
   * tarjetas, porque la carga real aplica ese crédito en cualquier
   * sustitución: cada tarjeta se juzga contra la carga que de verdad
   * ocurriría al usarla (el residente fuera, el candidato dentro),
   * no cargada encima de todo lo residente. Sin ella (sin residente
   * probado), la foto va sin crédito, como siempre.
   */
  residentLoad?: { model: CatalogModel; nCtx: number; memoryProfile?: LlmMemoryProfile } | null;
  /**
   * 0.1.118: si el motor tiene AHORA un modelo cargado (aunque su
   * crédito no se pueda calcular, p. ej. un archivo fuera del catálogo).
   * Sin modelo cargado, la tarjeta del activo no se carga «encima de sí
   * misma»: se juzga con la foto viva como las demás.
   */
  residentLoaded?: boolean;
  /**
   * G-1 (partida del móvil): el resumen de velocidad medida de este
   * modelo (la mediana de sus generaciones reales en este aparato,
   * desde la telemetría persistida), que la pantalla del gestor lee
   * al refrescar. Sin resumen o con la velocidad en null (menos de 2
   * muestras) la tarjeta no pinta nada: el «sin datos» es ausencia.
   */
  speedSummary?: ModelSpeedSummary | null;
  /**
   * 0.1.122 (decisión del dueño: «solo informar»): el mayor contexto con
   * el que este modelo respondió en ESTE aparato (provenLoads.ts). Es una
   * medida, no una promesa: nunca cambia qué se deja cargar.
   */
  provenCtx?: number | null;
  /**
   * 0.1.123 (auditoría E-1): el factor del CrashGuard con que la próxima
   * carga planificará (LlamaEngine.predictedCrashSafety). La insignia usa
   * el mismo plan y el mismo factor que la carga. Sin él, 1.
   */
  crashSafety?: number;
}

export function CatalogItemCard({ item, row, isActive, onDownload, onUse, onRemove, onDiscardPartial, activating, busy, residentLoad, residentLoaded, speedSummary, provenCtx, crashSafety }: Props) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => getStyles(colors, typography), [colors, typography]);

  const { t, i18n } = useTranslation();
  const isCorpus = item.kind === "corpus";
  // 0.1.125: el modelo de voz no se «usa»: con estar descargado, el
  // dictado lo toma solo (Whisper primero, Android de respaldo).
  const isSpeech = item.kind === "speech";
  const present = row?.present ?? false;
  const outdated = !present && (row?.outdated ?? false);
  const effectivelyActive = isCorpus || isSpeech ? present : isActive;

  // INDEX-FIX 2026-10-11: "en tu base de conocimiento" solo cuando el
  // paquete está indexado de verdad, no con solo tener el archivo.
  const [indexStatus, setIndexStatus] = useState<CorpusIndexStatus | null>(() =>
    isCorpus ? getCorpusIndexStatus() : null
  );
  useEffect(() => (isCorpus ? onCorpusIndexStatus(setIndexStatus) : undefined), [isCorpus]);
  const packIndex = indexStatus?.[item.id];

  const [deviceRam, setDeviceRam] = useState(0);
  // F3-14: la foto en vivo de la tarjeta. La insignia es la peor de
  // la canónica (por aparato) y la de este momento: un «cabe»
  // calculado en vacío dejaba de ser verdad con el teléfono ocupado,
  // que es cuando el usuario va a intentarlo.
  // 0.1.108: la foto ya no es solo la del montaje (la auditoría de la
  // pasada de la 0.1.107 la cazó juzgando para siempre por un
  // instante): se rehace cuando cambian los hechos de memoria que la
  // pantalla puede ver — el modelo activo cambia (una carga o una
  // descarga acaba de ocurrir: la pantalla refresca su estado y la
  // foto se rehace DESPUÉS) — y cuando la app vuelve a primer plano
  // (patrón de ExactAlarmCard/RelayCard).
  const [liveSnapshot, setLiveSnapshot] = useState<RamSnapshot | null>(null);
  const refreshLivePhoto = useCallback(() => {
    try {
      setDeviceRam(getDeviceTotalRamBytes());
      setLiveSnapshot(readRamSnapshot());
    } catch {
      // native module fallback
    }
  }, []);
  useEffect(() => {
    refreshLivePhoto();
  }, [refreshLivePhoto]);
  const firstActiveRef = useRef(true);
  useEffect(() => {
    if (firstActiveRef.current) {
      firstActiveRef.current = false;
      return;
    }
    refreshLivePhoto();
  }, [isActive, refreshLivePhoto]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") refreshLivePhoto();
    });
    return () => sub.remove();
  }, [refreshLivePhoto]);

  // 0.1.108 (A1): la foto viva lleva el crédito liberable que la
  // carga sí aplica: la huella estimada completa del residente.
  // Tanda too-heavy: el crédito ya no es solo de la tarjeta del
  // residente — la pantalla declara la carga residente del motor y
  // TODAS las tarjetas la aplican, porque es el crédito de la
  // sustitución que la carga haría al usar cualquiera de ellas.
  // La canónica nunca lleva crédito: sigue siendo el suelo.
  const residentCredit = useMemo(() => {
    if (!residentLoad || deviceRam <= 0) return 0;
    return residentReleasableBytes(
      residentLoad.model,
      residentLoad.nCtx,
      residentLoad.memoryProfile === "kv-q8",
      deviceRam,
    );
  }, [residentLoad, deviceRam]);
  const liveForBadge = useMemo<RamSnapshot | null>(() => {
    if (!liveSnapshot || residentCredit <= 0) return liveSnapshot;
    return { ...liveSnapshot, releasableBytes: residentCredit };
  }, [liveSnapshot, residentCredit]);

  // M-1 (espejo del móvil): el veredicto de ajuste también se calcula
  // para la entrada de embeddings — su fila enseña la insignia y en
  // rojo frena el gesto, como las de LLM. Corpus se queda en
  // «unknown»: su vía no es la de carga de modelos y la pieza no la
  // toca. Ningún cálculo nuevo: es el mismo computeCompatibility.
  // Tanda too-heavy: la tarjeta consume el DETALLE, no solo el color:
  // necesita saber de qué foto viene un rojo (la letra y el botón de
  // descarga dependen de eso) y declarar el suelo de la activa —
  // la tarjeta del modelo que el ajuste marca activo no se juzga
  // por la foto viva cuando ningún crédito probado la acompaña.
  const compatDetail =
    item.kind === "llm" || item.kind === "embedding"
      ? computeCompatibilityDetail(item, deviceRam, liveForBadge, {
          // 0.1.118 (foto del dueño, Tab A9+ sin modelo cargado): el
          // suelo solo vale con un modelo CARGADO cuyo crédito no se
          // conoce. Sin nada cargado, el activo pintaba «Runs well»
          // por la foto en vacío mientras un modelo más ligero salía
          // «Needs a lot of memory» por la foto del momento: dos
          // varas de medir en la misma pantalla.
          canonicalFloor: isActive && residentCredit <= 0 && (residentLoaded ?? residentLoad != null),
          crashSafety,
        })
      : ({ color: "unknown" } as CompatibilityDetail);
  const compatibility = compatDetail.color;
  // Rojo de APARATO: ni en vacío cabe; manda la conducta histórica
  // (sin botón de descarga, avisos acotados). Rojo de MOMENTO: la
  // canónica admite el modelo y es este instante el que no tiene
  // memoria libre; la letra lo dice y la descarga se sigue
  // ofreciendo, porque el archivo podrá cargarse en un momento
  // tranquilo.
  const deviceRed = compatibility === "red" && compatDetail.redSource !== "moment";
  const momentRed = compatibility === "red" && compatDetail.redSource === "moment";

  // 0.1.108 (A3): el chip «Default» nombra al default DE ESTE
  // APARATO, no a una bandera fija del catálogo: la bandera
  // `required` (que sigue protegiendo del borrado, intacta) marcaba
  // al 1.5B en todas partes, y en la tableta del dueño ese modelo ni
  // cabe — el chip coronaba justo al único pequeño en rojo. En LLM
  // el chip lo lleva el default calculado para la RAM del aparato
  // (defaultLlmForRam); en el resto (el embedding `required`) se
  // queda como hoy.
  const showDefaultChip =
    item.kind === "llm"
      ? deviceRam > 0 && defaultLlmForRam(deviceRam).id === item.id
      : item.required;
  const calculating = t("catalogItemCard.calculating");

  // Models added from the Hugging Face browser can be dropped from the list even if never downloaded.
  const fromHuggingFace = item.id.startsWith("hf-");
  const listOnly = fromHuggingFace && !present;

  const confirmRemove = () => {
    impact(ImpactFeedbackStyle.Medium);
    Alert.alert(
      listOnly
        ? t("catalogItemCard.removeFromListTitle")
        : isCorpus
          ? t("catalogItemCard.removeCorpusTitle")
          : t("catalogItemCard.removeModelTitle"),
      listOnly
        ? t("catalogItemCard.removeFromListMessage")
        : isCorpus
          ? t("catalogItemCard.removeCorpusMessage", { size: formatMB(item.sizeBytes) })
          : t("catalogItemCard.removeModelMessage", { size: formatMB(item.sizeBytes) }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("catalogItemCard.removeAssetButton"),
          style: "destructive",
          onPress: () => onRemove(item),
        },
      ]
    );
  };

  // 0.1.92: una descarga en pausa de un modelo que ya no ofrece botón.
  // Tanda too-heavy: «sin botón» es solo el rojo de aparato; en rojo
  // de momento el botón está y reanudar la descarga es el remedio,
  // así que la parte varada no se trata como varada.
  const strandedPartial =
    deviceRed && !present && (row?.partialBytes ?? 0) > 0 ? row!.partialBytes! : null;
  const durableNotice =
    !deviceRed
      ? (row?.statusNotice ?? null)
      : strandedPartial !== null
        ? t("installNotice.pausedTooHeavy", { done: formatMB(strandedPartial) })
        : null;

  const handleAction = (cb: () => void) => {
    impact(ImpactFeedbackStyle.Light);
    cb();
  };

  return (
    <View style={[styles.card, effectivelyActive && styles.cardActive]}>
      {/* Top Header Row */}
      <View style={styles.headerRow}>
        <View style={styles.titleColumn}>
          <Text style={styles.label}>{item.label}</Text>
          <View style={styles.metaChipsRow}>
            <View style={styles.kindChip}>
              <Text style={styles.kindChipText}>{t(`catalogItemCard.kind.${item.kind}`)}</Text>
            </View>
            <Text style={styles.metaText}>{formatMB(item.sizeBytes)}</Text>
            <Text style={styles.metaBullet}>•</Text>
            <Text style={styles.metaText}>{item.license}</Text>
            {showDefaultChip && (
              <>
                <Text style={styles.metaBullet}>•</Text>
                <Text style={styles.defaultChipText}>{t("catalogItemCard.default")}</Text>
              </>
            )}
            {/* G-1: la velocidad medida en este aparato, al final de
                la meta de la fila, solo cuando hay mediana que
                enseñar (≥ 2 generaciones que califican). */}
            {speedSummary?.medianTokPerSec != null && (
              <>
                <Text style={styles.metaBullet}>•</Text>
                <Text style={styles.metaText}>
                  {t("catalogItemCard.measuredRowSpeed", { rate: speedSummary.medianTokPerSec.toFixed(1) })}
                </Text>
              </>
            )}
          </View>
        </View>

        <StatusBadge
          present={present}
          outdated={outdated}
          active={effectivelyActive}
          downloading={row?.downloading ?? false}
        />
      </View>

      {/* Compatibility Badge */}
      {compatibility !== "unknown" && (
        <View style={styles.compatRow}>
          {compatibility === "green" && (
            <View style={[styles.compatPill, styles.compatGreen]}>
              <NidoIcon name="check" size={12} color={colors.text.accentEmerald} />
              <Text style={styles.compatGreenText}>{t("catalogItemCard.compat.green")}</Text>
            </View>
          )}
          {compatibility === "yellow" && (
            <View style={[styles.compatPill, styles.compatAmber]}>
              <NidoIcon name="warning" size={12} color={colors.text.accentAmber} />
              {/* 0.1.119: el amarillo dice lo que pasa de verdad — el
                  contexto con el que carga, de cuántos, y si va
                  comprimido — en lugar de «necesita mucha memoria». */}
              <Text style={styles.compatAmberText}>
                {compatDetail.yellow
                  ? t(
                      `catalogItemCard.compat.${compatDetail.yellow.source === "moment" ? "yellowNow" : "yellowDevice"}${compatDetail.yellow.kvCompressed ? "Q8" : ""}`,
                      { ctx: String(compatDetail.yellow.nCtx), max: String(compatDetail.yellow.ceiling) },
                    )
                  : t("catalogItemCard.compat.yellow")}
              </Text>
            </View>
          )}
          {compatibility === "red" && (
            <View style={[styles.compatPill, styles.compatRed]}>
              <NidoIcon name="error" size={12} color={colors.crimson[400]} />
              <Text style={styles.compatRedText}>
                {momentRed ? t("catalogItemCard.compat.redMoment") : t("catalogItemCard.compat.red")}
              </Text>
            </View>
          )}
        </View>
      )}

      {/* G-1: la base de la mediana, para que la cifra diga de dónde
          sale. Solo con velocidad que enseñar. */}
      {speedSummary?.medianTokPerSec != null && (
        <Text style={styles.measuredBasis}>
          {t("catalogItemCard.measuredBasis", { count: speedSummary.sampleCount })}
        </Text>
      )}

      {/* 0.1.122: la prueba real en este aparato, con su contexto. */}
      {provenCtx != null && provenCtx > 0 && (
        <Text style={styles.measuredBasis} testID="catalog-proven-ctx">
          {t("catalogItemCard.provenHere", { ctx: String(provenCtx) })}
        </Text>
      )}

      {/* Description */}
      <Text style={styles.description}>
        {t(`catalogDescriptions.${item.id.replace(/\./g, "_")}`, { defaultValue: item.description })}
      </Text>

      {/* 0.1.57: older pack kept and used until the update is verified */}
      {outdated && !row?.downloading && (
        <View style={styles.outdatedBox}>
          <NidoIcon name="warning" size={14} color={colors.text.accentAmber} />
          <Text style={styles.outdatedText}>{t("catalogItemCard.outdatedNote")}</Text>
        </View>
      )}

      {/* 0.1.90 (familia 3): el motivo durable, cuando no hay un error
          en memoria más fresco que pintar ni una descarga en curso. */}
      {/* 0.1.92: en rojo de aparato no hay botón de descarga, así que
          los avisos que terminan en «si descargas otra vez…»
          prometían un botón que no está: en ese rojo solo se dice lo
          que sí tiene remedio — la parte descargada que ocupa sitio
          y se puede borrar. (En rojo de momento el botón sí está y
          el aviso durable se pinta como en cualquier otro color.) */}
      {durableNotice && !row?.downloading && !row?.error && (
        <View style={styles.outdatedBox}>
          <NidoIcon name="warning" size={14} color={colors.text.accentAmber} />
          <Text style={styles.outdatedText}>{durableNotice}</Text>
        </View>
      )}

      {/* Error Callout */}
      {row?.error && (
        <View style={styles.errorBox}>
          <NidoIcon name="warning" size={14} />
          <Text style={styles.errorText}>{row.error}</Text>
        </View>
      )}

      {/* Smooth Background Download Progress Card */}
      {row?.downloading && (
        <View style={styles.downloadProgressCard}>
          <View style={styles.downloadProgressHeader}>
            <View style={styles.downloadProgressLeft}>
              <ActivityIndicator size="small" color={colors.emerald[400]} />
              <Text style={styles.downloadStatusTitle}>{t("catalogItemCard.downloadingAsset")}</Text>
            </View>
            <Text style={styles.downloadProgressPct}>
              {(row.progress * 100).toFixed(0)}%
            </Text>
          </View>

          {/* Progress Bar Track */}
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: `${Math.max(row.progress * 100, 2)}%` },
              ]}
            />
          </View>

          {/* Download Telemetry Row (Bytes, Speed, ETA) */}
          <View style={styles.downloadMetricsRow}>
            <Text style={styles.metricText}>
              {row.bytesWritten ? formatMB(row.bytesWritten) : "0 MB"} / {formatMB(item.sizeBytes)}
            </Text>
            <View style={styles.metricsRight}>
              <Text style={styles.metricSpeedText}>
                {formatSpeed(row.speedBytesPerSec, calculating)}
              </Text>
              <Text style={styles.metricBullet}>•</Text>
              <Text style={styles.metricEtaText}>
                {t("catalogItemCard.eta", { eta: formatEta(row.etaSeconds, calculating) })}
              </Text>
            </View>
          </View>
        </View>
      )}

      {/* Action Controls */}
      {!row?.downloading && (
        <View style={styles.actionsRow}>
          {/* 0.1.90: la insignia ES el veredicto de la vía de carga
              (0.1.86): en rojo ningún peldaño cabe en este aparato,
              así que el archivo descargado jamás podría usarse aquí.
              Ofrecer la descarga (o el reintento) era prometer 4,4 GB
              muertos: en rojo no hay botón. En «unknown» (RAM aún sin
              leer, o no-LLM) el botón queda como siempre.
              Tanda too-heavy: eso manda solo en el rojo de APARATO.
              En rojo de momento el modelo sí cabe en este aparato —
              es el instante el que no tiene memoria libre — y la
              descarga se ofrece: el archivo podrá cargarse cuando
              el momento sea tranquilo. */}
          {!present && !deviceRed && (
            <Pressable accessibilityRole="button"
              style={styles.downloadBtn}
              onPress={() => handleAction(() => onDownload(item))}
            >
              <Text style={styles.downloadBtnText}>
                {row?.error
                  ? t("catalogItemCard.retryDownload")
                  : outdated
                    ? t("catalogItemCard.updateAsset")
                    : t("catalogItemCard.downloadAsset")}
              </Text>
            </Pressable>
          )}

          {strandedPartial !== null && onDiscardPartial && (
            <Pressable accessibilityRole="button"
              style={styles.downloadBtn}
              onPress={() => handleAction(() => onDiscardPartial(item))}
            >
              <Text style={styles.downloadBtnText}>{t("catalogItemCard.discardPartial")}</Text>
            </Pressable>
          )}

          {present && !isCorpus && !isSpeech && !isActive && activating && (
            <View style={styles.activeCheckRow}>
              <ActivityIndicator size="small" color={colors.emerald[400]} />
              <Text style={styles.activeNote}>{t("catalogItemCard.loadingModel")}</Text>
            </View>
          )}

          {present && !isCorpus && !isSpeech && !isActive && !activating && (
            <Pressable accessibilityRole="button" accessibilityLabel={t("catalogItemCard.selectUse")}
              style={[styles.useBtn, busy && styles.disabled]}
              onPress={() => handleAction(() => onUse(item))}
              disabled={busy}
            >
              <Text style={styles.useBtnText}>{t("catalogItemCard.selectUse")}</Text>
            </Pressable>
          )}

          {present && isCorpus && packIndex && packIndex.indexed < packIndex.total && (
            <View style={styles.activeCheckRow}>
              <ActivityIndicator size="small" color={colors.emerald[400]} />
              <Text style={styles.activeNote}>
                {t("catalogItemCard.indexingNote", {
                  done: formatInt(packIndex.indexed, displayLang(i18n.language)),
                  total: formatInt(packIndex.total, displayLang(i18n.language)),
                })}
              </Text>
            </View>
          )}

          {present && isCorpus && (!packIndex || packIndex.indexed >= packIndex.total) && (
            <View style={styles.activeCheckRow}>
              <NidoIcon name="check" size={14} color={colors.text.accentEmerald} />
              <Text style={styles.activeNote}>
                {/* Paquetes que no pasan por el indexado (sqlite-pack, ya
                    indexados de fábrica) o estado aún no comprobado en esta
                    sesión: sin estado se dice solo "Descargado". */}
                {packIndex || item.format === "sqlite-pack"
                  ? t("catalogItemCard.indexedNote")
                  : t("catalogItemCard.downloadedNote")}
              </Text>
            </View>
          )}

          {present && isSpeech && (
            <View style={styles.activeCheckRow}>
              <NidoIcon name="check" size={14} color={colors.text.accentEmerald} />
              <Text style={styles.activeNote}>{t("catalogItemCard.speechReadyNote")}</Text>
            </View>
          )}

          {present && !isCorpus && !isSpeech && isActive && (
            <View style={styles.activeCheckRow}>
              <NidoIcon name="check" size={14} color={colors.text.accentEmerald} />
              <Text style={styles.activeNote}>{t("catalogItemCard.activeNote")}</Text>
            </View>
          )}

          {(present || outdated || fromHuggingFace) && !item.required && (
            <Pressable accessibilityRole="button"
              onPress={confirmRemove}
              hitSlop={8}
              disabled={busy}
              style={[styles.trashBtn, busy && styles.disabled]}
              accessibilityLabel={t("catalogItemCard.deleteAccessibility")}
            >
              <NidoIcon name="delete" size={16} />
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

function StatusBadge({
  present,
  outdated,
  active,
  downloading,
}: {
  present: boolean;
  outdated: boolean;
  active: boolean;
  downloading: boolean;
}) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => getStyles(colors, typography), [colors, typography]);

  const { t } = useTranslation();
  if (downloading) {
    return (
      <View style={[styles.badge, styles.badgeDownloading]}>
        <Text style={styles.badgeTextCyan}>{t("catalogItemCard.badge.downloading")}</Text>
      </View>
    );
  }
  if (outdated) {
    return (
      <View style={[styles.badge, styles.badgeOutdated]}>
        <Text style={styles.badgeTextAmber}>{t("catalogItemCard.badge.outdated")}</Text>
      </View>
    );
  }
  if (!present) {
    return (
      <View style={[styles.badge, styles.badgeGrey]}>
        <Text style={styles.badgeTextMuted}>{t("catalogItemCard.badge.notOnDisk")}</Text>
      </View>
    );
  }
  if (active) {
    return (
      <View style={[styles.badge, styles.badgeActive]}>
        <View style={styles.activeDot} />
        <Text style={styles.badgeTextEmerald}>{t("catalogItemCard.badge.active")}</Text>
      </View>
    );
  }
  return (
    <View style={[styles.badge, styles.badgeCached]}>
      <Text style={styles.badgeTextCached}>{t("catalogItemCard.badge.cached")}</Text>
    </View>
  );
}

const getStyles = (colors: Colors, typography: Typography) => StyleSheet.create({
  card: {
    backgroundColor: colors.bg.cardElevated,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  cardActive: {
    borderColor: colors.emerald.border,
    backgroundColor: colors.emerald.bgSubtle,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 8,
  },
  titleColumn: {
    flex: 1,
    gap: 4,
  },
  label: {
    ...typography.ui.titleSm,
    color: colors.text.heading,
  },
  metaChipsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  kindChip: {
    backgroundColor: colors.bg.subtle,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: radii.xs,
  },
  kindChipText: {
    ...typography.mono.xs,
    fontSize: 9,
    color: colors.text.secondary,
    fontWeight: "700",
  },
  metaText: {
    ...typography.mono.xs,
    color: colors.text.dim,
  },
  metaBullet: {
    ...typography.mono.xs,
    color: colors.text.dim,
  },
  defaultChipText: {
    ...typography.mono.xs,
    fontSize: 9,
    color: colors.text.accentCyan,
    fontWeight: "700",
  },
  compatRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  measuredBasis: {
    ...typography.mono.xs,
    color: colors.text.dim,
  },
  compatPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.sm,
    borderWidth: 1,
    gap: 5,
  },
  compatIcon: {
    fontFamily: fontFamilies.sans,
    fontSize: 10,
  },
  compatGreen: {
    backgroundColor: colors.emerald.bgSubtle,
    borderColor: colors.emerald.border,
  },
  compatGreenText: {
    ...typography.mono.xs,
    color: colors.text.accentEmerald,
    fontWeight: "700",
  },
  compatAmber: {
    backgroundColor: colors.amber.bgSubtle,
    borderColor: colors.amber.border,
  },
  compatAmberText: {
    ...typography.mono.xs,
    // S-03: texto ámbar menudo — en Daylight, el ámbar corregido
    // (amber.600); accentAmber queda para iconos y titulares.
    color: colors.id === "daylight" ? colors.amber[600] : colors.text.accentAmber,
    fontWeight: "700",
  },
  compatRed: {
    backgroundColor: colors.crimson.bgSubtle,
    borderColor: colors.crimson.border,
  },
  compatRedText: {
    ...typography.mono.xs,
    color: colors.crimson[400],
    fontWeight: "700",
  },
  description: {
    ...typography.ui.caption,
    color: colors.text.secondary,
    lineHeight: 18,
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.crimson.bgSubtle,
    borderColor: colors.crimson.border,
    borderWidth: 1,
    borderRadius: radii.sm,
    padding: spacing.sm,
    gap: 6,
  },
  outdatedBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.amber.bgSubtle,
    borderColor: colors.amber.border,
    borderWidth: 1,
    borderRadius: radii.sm,
    padding: spacing.sm,
    gap: 6,
  },
  outdatedText: {
    ...typography.ui.caption,
    color: colors.text.primary,
    flex: 1,
  },
  badgeOutdated: {
    backgroundColor: colors.amber.bgSubtle,
    borderColor: colors.amber.border,
  },
  badgeTextAmber: {
    ...typography.mono.xs,
    fontSize: 9,
    // S-03: texto ámbar menudo — en Daylight, el ámbar corregido.
    color: colors.id === "daylight" ? colors.amber[600] : colors.text.accentAmber,
    fontWeight: "800",
  },
  errorIcon: {
    fontFamily: fontFamilies.sans,
    fontSize: 12,
  },
  errorText: {
    ...typography.mono.xs,
    color: colors.crimson[400],
    flex: 1,
  },
  downloadProgressCard: {
    backgroundColor: colors.bg.terminal,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border.default,
    padding: spacing.sm,
    gap: 6,
  },
  downloadProgressHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  downloadProgressLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  downloadStatusTitle: {
    ...typography.mono.xs,
    color: colors.text.accentCyan,
    fontWeight: "700",
  },
  downloadProgressPct: {
    ...typography.mono.xs,
    color: colors.text.heading,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  progressTrack: {
    height: 8,
    backgroundColor: colors.bg.modalOverlay,
    borderRadius: radii.xs,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: colors.emerald[500],
    borderRadius: radii.xs,
  },
  downloadMetricsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  metricText: {
    ...typography.mono.xs,
    color: colors.text.dim,
    fontVariant: ["tabular-nums"],
  },
  metricsRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  metricSpeedText: {
    ...typography.mono.xs,
    color: colors.text.accentCyan,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  metricBullet: {
    ...typography.mono.xs,
    color: colors.text.dim,
  },
  metricEtaText: {
    ...typography.mono.xs,
    // S-03: texto ámbar menudo — en Daylight, el ámbar corregido.
    color: colors.id === "daylight" ? colors.amber[600] : colors.text.accentAmber,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  actionsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 4,
  },
  downloadBtn: {
    backgroundColor: colors.emerald.bgSubtle,
    borderColor: colors.emerald.border,
    borderWidth: 1,
    borderRadius: 9999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 44,
    justifyContent: "center",
  },
  downloadBtnText: {
    ...typography.ui.titleSm,
    fontSize: 12,
    color: colors.text.accentEmerald,
  },
  disabled: { opacity: 0.4 },
  useBtn: {
    backgroundColor: colors.cyan.bgSubtle,
    borderColor: colors.cyan.border,
    borderWidth: 1,
    borderRadius: radii.sm,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  useBtnText: {
    ...typography.ui.titleSm,
    fontSize: 12,
    color: colors.text.accentCyan,
  },
  activeCheckRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    flex: 1,
  },
  activeCheckIcon: {
    color: colors.text.accentEmerald,
    fontWeight: "800",
  },
  activeNote: {
    ...typography.mono.xs,
    color: colors.text.accentEmerald,
    fontWeight: "600",
  },
  trashBtn: {
    marginLeft: "auto",
    padding: 6,
    borderRadius: radii.xs,
    backgroundColor: colors.bg.subtle,
  },
  trashIcon: {
    fontFamily: fontFamilies.sans,
    fontSize: 14,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.xs,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  badgeGrey: {
    backgroundColor: colors.bg.subtle,
    borderColor: colors.border.subtle,
  },
  badgeTextMuted: {
    ...typography.mono.xs,
    fontSize: 9,
    color: colors.text.dim,
    fontWeight: "700",
  },
  badgeActive: {
    backgroundColor: colors.emerald.bgSubtle,
    borderColor: colors.emerald.border,
  },
  activeDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: colors.emerald[400],
  },
  badgeTextEmerald: {
    ...typography.mono.xs,
    fontSize: 9,
    color: colors.text.accentEmerald,
    fontWeight: "800",
  },
  badgeCached: {
    backgroundColor: colors.cyan.bgSubtle,
    borderColor: colors.cyan.border,
  },
  badgeTextCached: {
    ...typography.mono.xs,
    fontSize: 9,
    color: colors.text.accentCyan,
    fontWeight: "700",
  },
  badgeDownloading: {
    backgroundColor: colors.cyan.bgSubtle,
    borderColor: colors.cyan.border,
  },
  badgeTextCyan: {
    ...typography.mono.xs,
    fontSize: 9,
    color: colors.text.accentCyan,
    fontWeight: "800",
  },
});
