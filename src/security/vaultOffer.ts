/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * vaultOffer.ts — 0.1.51: cuándo ofrecer la protección por hardware en la
 * pantalla principal (ver src/ui/VaultOfferBanner.tsx).
 */
import { isVaultActive, vaultStatus } from "./keyVault";
import { getVaultOfferState } from "../models/settings";

/** "Ahora no" la esconde una semana. */
export const VAULT_OFFER_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * ¿Toca mostrar la oferta? Solo si el teléfono la soporta, no está activa y
 * el dueño no dijo "no volver a preguntar" ni "ahora no" hace menos de una
 * semana. Nunca lanza: ante cualquier duda, no se muestra.
 */
export async function shouldOfferVault(now = Date.now()): Promise<boolean> {
  try {
    const st = await getVaultOfferState();
    if (st.never || st.snoozeUntil > now) return false;
    const status = await vaultStatus();
    if (!status || !status.supported) return false;
    return !(await isVaultActive());
  } catch {
    return false;
  }
}
