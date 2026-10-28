/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * packShareApp.ts — 0.1.55: conecta packShareService con la app real
 * (archivos de expo-file-system, packs de rag/packs y el messenger).
 * La lógica que importa (qué se comparte y qué se instala) vive en
 * packShareWiring.ts, probada sin teléfono.
 */
import * as FileSystem from "expo-file-system/legacy";
import { packShareService } from "./packShareService";
import { isAcceptableOffer, makePackDataProvider, makePackImporter, type PackShareDeps } from "./packShareWiring";
import type { CatalogModel } from "../models/manifest";

/** Lo mínimo del messenger que hace falta (NidoMessenger.sendPackShare). */
export interface PackShareMessenger {
  sendPackShare(
    peerPkHex: string,
    action: "OFFER" | "ACCEPT" | "DECLINE" | "CHUNK" | "CHUNK_ACK" | "COMPLETE" | "CANCEL",
    sessionId: string,
    data: Record<string, unknown>,
  ): Promise<boolean>;
}

/** Último catálogo leído, para el filtro de ofertas (que es síncrono). */
let packsSnapshot: CatalogModel[] = [];

function appDeps(): PackShareDeps {
  return {
    listPacks: async () => {
      const { knowledgePacks } = await import("../rag/packs");
      packsSnapshot = await knowledgePacks();
      return packsSnapshot;
    },
    docDir: FileSystem.documentDirectory ?? "",
    readBase64: (path) => FileSystem.readAsStringAsync(path, { encoding: FileSystem.EncodingType.Base64 }),
    writeBase64: async (path, data) => {
      // Quien nunca descargó un pack no tiene aún la carpeta corpus/.
      const dir = path.slice(0, path.lastIndexOf("/") + 1);
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
      await FileSystem.writeAsStringAsync(path, data, { encoding: FileSystem.EncodingType.Base64 });
    },
    move: (from, to) => FileSystem.moveAsync({ from, to }),
    remove: (path) => FileSystem.deleteAsync(path, { idempotent: true }),
    closePack: async (id) => {
      const { closePack } = await import("../rag/packs");
      await closePack(id);
    },
    afterImport: async () => {
      // Igual que tras una descarga: preparar el índice de búsqueda del pack.
      const { prepareVectorIndexes } = await import("../rag/packs");
      const { embeddingEngine } = await import("../rag/embed");
      void prepareVectorIndexes(embeddingEngine.loadedModelSha256, embeddingEngine.profile);
    },
  };
}

/**
 * Deja el servicio listo: identidad, envío por la sesión P2P, bytes de los
 * packs instalados, importador verificado y filtro de ofertas.
 */
export async function wirePackShare(messenger: PackShareMessenger, myPkHex: string): Promise<void> {
  const deps = appDeps();
  await deps.listPacks().catch(() => []);
  packShareService.setLocalIdentity(myPkHex);
  packShareService.setSendFunction(async (peerPkHex, action, sessionId, data) => {
    const sent = await messenger.sendPackShare(peerPkHex, action, sessionId, data);
    // La oferta es lo único que la pantalla espera en el momento: si no
    // salió (contacto sin conexión), se dice. El resto lo cubren los
    // tiempos de espera del servicio.
    if (!sent && action === "OFFER") throw new Error("Sin conexión con el contacto");
  });
  packShareService.setDataProvider(makePackDataProvider(deps));
  packShareService.setImporter(makePackImporter(deps));
  packShareService.setOfferFilter((adv) => isAcceptableOffer(packsSnapshot, adv));
}
