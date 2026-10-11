/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { requireNativeModule } from "expo-modules-core";

/** Diseño: docs/design/BLOQUEO_BIOMETRICO_REAL.md */
export type VaultSecurityLevel = "strongbox" | "tee" | "software" | "unknown";

export interface VaultStatus {
  /** La tablet tiene PIN/patrón/contraseña (requisito para la llave protegida). */
  supported: boolean;
  kekExists: boolean;
  securityLevel: VaultSecurityLevel;
  apiLevel: number;
}

export type VaultAuthResult = "ok" | "cancelled" | "failed";

export interface NidoKeyVaultNative {
  getStatus(): Promise<VaultStatus>;
  ensureKek(): Promise<VaultStatus>;
  authenticate(title: string, subtitle: string): Promise<VaultAuthResult>;
  /** Cifra con la KEK (requiere authenticate() en los últimos 30 s). */
  wrap(plainB64: string): Promise<string>;
  unwrap(blobB64: string): Promise<string>;
  deleteKek(): Promise<void>;
}

const NidoKeyVault = requireNativeModule<NidoKeyVaultNative>("NidoKeyVault");
export default NidoKeyVault;
