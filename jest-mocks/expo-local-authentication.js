// MIT License
// Copyright (c) 2026 NIDO contributors
// See LICENSE file for details.
//
// Stub de expo-local-authentication para Jest: su build es ESM y Jest no
// lo transforma. Refleja un dispositivo sin biometría enrolada.
module.exports = {
  hasHardwareAsync: jest.fn(async () => false),
  isEnrolledAsync: jest.fn(async () => false),
  getEnrolledLevelAsync: jest.fn(async () => 0),
  supportedAuthenticationTypesAsync: jest.fn(async () => []),
  authenticateAsync: jest.fn(async () => ({ success: false })),
  AuthenticationType: { FINGERPRINT: 1, FACIAL_RECOGNITION: 2, IRIS: 3 },
  SecurityLevel: { NONE: 0, SECRET: 1, BIOMETRIC_STRONG: 2, BIOMETRIC_WEAK: 3 },
};
