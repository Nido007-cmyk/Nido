// MIT License
// Copyright (c) 2026 NIDO contributors
// See LICENSE file for details.
//
// Stub de expo-notifications para Jest: su build es ESM y Jest no lo
// transforma. Los tests de componentes no ejercitan notificaciones.
const sub = { remove: () => {} };
module.exports = {
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(async () => ({ status: "granted", granted: true })),
  requestPermissionsAsync: jest.fn(async () => ({ status: "granted", granted: true })),
  scheduleNotificationAsync: jest.fn(async () => "test-id"),
  cancelScheduledNotificationAsync: jest.fn(async () => {}),
  cancelAllScheduledNotificationsAsync: jest.fn(async () => {}),
  getAllScheduledNotificationsAsync: jest.fn(async () => []),
  addNotificationReceivedListener: jest.fn(() => sub),
  addNotificationResponseReceivedListener: jest.fn(() => sub),
  setNotificationCategoryAsync: jest.fn(async () => {}),
  SchedulableTriggerInputTypes: { DATE: "date", TIME_INTERVAL: "timeInterval", DAILY: "daily", WEEKLY: "weekly", MONTHLY: "monthly", YEARLY: "yearly" },
  AndroidImportance: { DEFAULT: 3, HIGH: 4, MAX: 5 },
};
