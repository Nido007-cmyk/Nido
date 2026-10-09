/*
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { requireNativeModule } from "expo-modules-core";

const ExactAlarm = requireNativeModule("ExactAlarm");

export async function canScheduleExactAlarms(): Promise<boolean> {
  try {
    return await ExactAlarm.canScheduleExactAlarms();
  } catch {
    return false;
  }
}

export async function openExactAlarmSettings(): Promise<boolean> {
  try {
    return await ExactAlarm.openExactAlarmSettings();
  } catch {
    return false;
  }
}
