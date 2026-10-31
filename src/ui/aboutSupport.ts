/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Direcciones públicas del proyecto para aportaciones voluntarias al
 * desarrollo de NIDO (pantalla «Acerca de», tarjeta «Desarrollo de NIDO»).
 *
 * FUENTE ÚNICA, A PROPÓSITO: cada dirección se escribe UNA sola vez, aquí.
 * El texto visible de la pantalla, el QR, el botón «Copiar» y el toque
 * sobre la propia dirección leen todos de esta tabla — nadie transcribe
 * una dirección a mano en otro sitio, porque cada transcripción es una
 * oportunidad de errata con dinero real de por medio. La prueba
 * aboutSupport.test.ts trae los literales escritos por segunda vez, de
 * forma independiente: si esta tabla y la prueba discrepan en un solo
 * carácter, la batería se pone roja.
 *
 * La app solo MUESTRA las direcciones: no procesa pagos, no verifica
 * transacciones y no hace ninguna llamada de red por esta nota.
 */
import * as Clipboard from "expo-clipboard";

export interface SupportAddress {
  /** Red de la dirección; también elige la etiqueta localizada en la pantalla. */
  id: "solana" | "base";
  /** La dirección completa y exacta, tal como debe llegar al portapapeles. */
  address: string;
}

export const SUPPORT_ADDRESSES: readonly SupportAddress[] = [
  { id: "solana", address: "G74aAtEB41eFAcXtRbBVcRVpZDgELBCoFeUo9AyTnjRK" },
  { id: "base", address: "0x5c030688FAcF0c74a5fF5eB00686A0021d95c1fC" },
];

/**
 * Copia la dirección al portapapeles, sin tocarla: ni espacios, ni saltos
 * de línea, ni recortes. Es el ÚNICO camino de copiado de la pantalla —
 * lo llaman tanto el botón «Copiar» como el toque sobre la dirección.
 */
export async function copySupportAddress(address: string): Promise<void> {
  await Clipboard.setStringAsync(address);
}
