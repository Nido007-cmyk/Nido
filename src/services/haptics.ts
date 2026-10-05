/**
 * App-wide gate on haptic feedback, respecting the user's `hapticsEnabled`
 * setting (src/models/settings.ts, default true — no battery case for
 * defaulting it off; each pulse is milliseconds of vibration-motor draw,
 * negligible next to actual LLM inference, this is a preference toggle,
 * not a power-saving one).
 *
 * Previously this setting only actually worked inside ChatScreen.tsx (its
 * own local wrapper) — every other screen called expo-haptics directly, so
 * turning haptics off did almost nothing app-wide. This module is the
 * single place that decision is made now; every caller uses `impact`/
 * `notification` from here instead of importing expo-haptics directly.
 *
 * Cached in memory (loaded once via `initHaptics`, updated immediately by
 * `setHapticsEnabledCache` when the user flips the setting) rather than
 * reading settings.ts on every single tap — haptic feedback needs to fire
 * synchronously with the gesture that triggered it, not after an async
 * file read resolves.
 */
import * as Haptics from "expo-haptics";
import { getHapticsEnabled } from "../models/settings";

export { ImpactFeedbackStyle, NotificationFeedbackType } from "expo-haptics";

let enabled = true;

/** Call once at app startup (App.tsx) to load the real persisted value — defaults to true (matches settings.ts's own default) until this resolves, so nothing is ever blocked waiting on it. */
export async function initHaptics(): Promise<void> {
  enabled = await getHapticsEnabled();
}

/** Call immediately after persisting a change via setHapticsEnabled(), so the new value takes effect on the very next tap instead of only after a reload. */
export function setHapticsEnabledCache(value: boolean): void {
  enabled = value;
}

export function impact(style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light): void {
  if (enabled) Haptics.impactAsync(style).catch(() => {});
}

export function notification(type: Haptics.NotificationFeedbackType): void {
  if (enabled) Haptics.notificationAsync(type).catch(() => {});
}
