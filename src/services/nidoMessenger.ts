/**
 * nidoMessenger.ts — singleton compartido del messenger P2P.
 *
 * La UI (NidoScreen) y el agente (handlers) deben usar LA MISMA instancia:
 * las sesiones cifradas y los reensambladores viven en memoria dentro del
 * messenger; dos instancias = sesiones separadas y mensajes perdidos.
 *
 * R6 (wipe-terminal): durante Clear All Data, appReset llama a
 * `invalidateSharedNidoMessenger()`: la instancia actual se destruye
 * (transporte detenido, sesiones/identidad en memoria descartadas) y el
 * singleton se desacopla. Ningún objeto viejo puede seguir operando ni
 * ningún frame entrante puede persistir nada: la base de memoria que
 * alimenta el store P2P está invalidada por su propio ciclo de vida.
 */
import { NidoMessenger } from "../p2p/messenger";

let shared: NidoMessenger | null = null;
/**
 * Mientras sea true, getSharedNidoMessenger() se niega a crear una
 * instancia nueva: Clear All Data está en curso y un messenger nuevo podría
 * inicializarse contra estado parcialmente borrado. Se levanta solo cuando
 * el wipe termina con éxito (completeP2PDataReset) o cuando la app se
 * reinicia tras una recuperación. Si el wipe falla, permanece bloqueado:
 * fail closed.
 */
let resetInProgress = false;

export function getSharedNidoMessenger(): NidoMessenger {
  if (resetInProgress) {
    throw new Error(
      "P2P no disponible: Clear All Data en curso. Se requiere completar el borrado."
    );
  }
  if (!shared) shared = new NidoMessenger();
  return shared;
}

/**
 * Invalida el runtime P2P vivo como parte de Clear All Data. Se marca el
 * bloqueo ANTES del primer await (ningún messenger nuevo puede nacer en
 * medio del wipe), se desacopla el singleton y se destruye la instancia:
 * transporte detenido + sesiones/identidad en memoria descartadas.
 */
export async function beginP2PDataReset(): Promise<void> {
  resetInProgress = true;
  const old = shared;
  shared = null;
  if (old) {
    await old.destroy();
  }
}

/**
 * Levanta el bloqueo tras un wipe completado y verificado: el próximo
 * getSharedNidoMessenger() crea una instancia fresca del ciclo nuevo
 * (identidad nueva, sin sesiones heredadas).
 */
export function completeP2PDataReset(): void {
  resetInProgress = false;
}

/** Solo para tests: estado del bloqueo. */
export function isP2PDataResetInProgress(): boolean {
  return resetInProgress;
}
