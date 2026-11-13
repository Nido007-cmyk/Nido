/*
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Notificaciones locales de NIDO (paquete NIDO-SIN-GOOGLE-2026-11-13).
 *
 * Sustituye a expo-notifications, que traía Firebase, Google Play
 * Services y el Install Referrer de Google Play solo por sus avisos push,
 * que NIDO nunca usó. Esta fachada expone exactamente lo que NIDO usaba,
 * con los mismos nombres y las mismas formas, para que el resto del código
 * no cambie: programar, mostrar, cancelar y despedir avisos locales, crear
 * canales, pedir el permiso y enterarse de que un aviso se entregó.
 *
 * El módulo nativo se resuelve al usarlo (como exact-alarm): sin la parte
 * nativa, cada llamada falla y los llamantes ya tratan ese fallo.
 */
import { requireOptionalNativeModule } from "expo-modules-core";
import { toNativeRequest, type NotificationRequestInput } from "./triggers";

export {
  AndroidImportance,
  AndroidNotificationVisibility,
  SchedulableTriggerInputTypes,
  toNativeRequest,
  toNativeTrigger,
} from "./triggers";
export type {
  NativeRequest,
  NativeTrigger,
  NotificationRequestInput,
  NotificationTriggerInput,
} from "./triggers";

interface Subscription {
  remove(): void;
}

interface NidoNotifyNative {
  requestPermissionsAsync(): Promise<{ status: "granted" | "denied" | "undetermined"; granted: boolean; canAskAgain: boolean }>;
  setNotificationChannelAsync(id: string, options: Record<string, unknown>): Promise<void>;
  scheduleNotificationAsync(request: Record<string, unknown>): Promise<string>;
  cancelScheduledNotificationAsync(identifier: string): Promise<void>;
  cancelAllScheduledNotificationsAsync(): Promise<void>;
  getAllScheduledNotificationsAsync(): Promise<string[]>;
  getPresentedNotificationsAsync(): Promise<string[]>;
  dismissNotificationAsync(identifier: string): Promise<void>;
  dismissAllNotificationsAsync(): Promise<void>;
  consumeLegacyStoreAsync(): Promise<boolean>;
  addListener(event: "onNotificationReceived", listener: (e: { identifier: string }) => void): Subscription;
}

function native(): NidoNotifyNative {
  let m: NidoNotifyNative | null = null;
  try {
    m = requireOptionalNativeModule<NidoNotifyNative>("NidoNotify");
  } catch {
    m = null;
  }
  if (!m) throw new Error("nido-notify: native module unavailable");
  return m;
}

export interface ChannelInput {
  name: string;
  importance: number;
  vibrationPattern?: number[];
  sound?: string | null;
  lockscreenVisibility?: number;
}

/** Lo que recibe quien escucha: la misma forma que daba expo. */
export interface DeliveredNotification {
  request: { identifier: string };
}

export async function requestPermissionsAsync() {
  return native().requestPermissionsAsync();
}

export async function setNotificationChannelAsync(id: string, channel: ChannelInput): Promise<void> {
  // Solo las claves presentes viajan: "sound" ausente no toca el sonido
  // del canal; "sound": null lo quita (como expo).
  const options: Record<string, unknown> = { name: channel.name, importance: channel.importance };
  if (channel.vibrationPattern) options.vibrationPattern = channel.vibrationPattern;
  if ("sound" in channel) options.sound = channel.sound ?? null;
  if (channel.lockscreenVisibility !== undefined) options.lockscreenVisibility = channel.lockscreenVisibility;
  await native().setNotificationChannelAsync(id, options);
}

export async function scheduleNotificationAsync(request: NotificationRequestInput): Promise<string> {
  const payload = toNativeRequest(request);
  return native().scheduleNotificationAsync(payload as unknown as Record<string, unknown>);
}

export async function cancelScheduledNotificationAsync(identifier: string): Promise<void> {
  await native().cancelScheduledNotificationAsync(identifier);
}

export async function cancelAllScheduledNotificationsAsync(): Promise<void> {
  await native().cancelAllScheduledNotificationsAsync();
}

export async function getAllScheduledNotificationsAsync(): Promise<{ identifier: string }[]> {
  return (await native().getAllScheduledNotificationsAsync()).map((identifier) => ({ identifier }));
}

export async function getPresentedNotificationsAsync(): Promise<DeliveredNotification[]> {
  return (await native().getPresentedNotificationsAsync()).map((identifier) => ({ request: { identifier } }));
}

export async function dismissNotificationAsync(identifier: string): Promise<void> {
  await native().dismissNotificationAsync(identifier);
}

export async function dismissAllNotificationsAsync(): Promise<void> {
  await native().dismissAllNotificationsAsync();
}

/** Un aviso se entregó con la app viva (para marcar recordatorios cumplidos). */
export function addNotificationReceivedListener(listener: (n: DeliveredNotification) => void): Subscription {
  return native().addListener("onNotificationReceived", (e) => listener({ request: { identifier: e.identifier } }));
}

/**
 * true una sola vez tras actualizar desde una versión con expo-notifications:
 * el almacén viejo se ha borrado y lo pendiente hay que programarlo de nuevo.
 */
export async function consumeLegacyStoreAsync(): Promise<boolean> {
  return native().consumeLegacyStoreAsync();
}
