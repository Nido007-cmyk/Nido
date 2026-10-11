/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { requireNativeModule } from "expo-modules-core";

/** Diseño: docs/design/BLOQUEO_BIOMETRICO_REAL.md */
export type VaultSecurityLevel = "strongbox" | "tee" | "software" | "unknown";

export interface VaultStatus {
  /** Android 11+, la tablet tiene PIN/patrón/contraseña y puede autenticar. */
  supported: boolean;
  kekExists: boolean;
  securityLevel: VaultSecurityLevel;
  apiLevel: number;
}

export interface NidoKeyVaultNative {
  getStatus(): Promise<VaultStatus>;
  ensureKek(): Promise<VaultStatus>;
  /** Diálogo de PIN/huella ligado a ESTA operación; devuelve el blob (base64). */
  wrapWithAuth(plainB64: string, title: string, subtitle: string): Promise<string>;
  /** Diálogo de PIN/huella ligado a ESTA operación; devuelve la DEK (base64). */
  unwrapWithAuth(blobB64: string, title: string, subtitle: string): Promise<string>;
  deleteKek(): Promise<void>;
  /** Nivel B: cierra NIDO por completo (borra todo de la memoria). */
  terminateProcess(): Promise<void>;
}

const NidoKeyVault = requireNativeModule<NidoKeyVaultNative>("NidoKeyVault");
export default NidoKeyVault;
