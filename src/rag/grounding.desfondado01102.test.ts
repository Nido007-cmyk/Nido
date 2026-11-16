/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * 0.1.102 (foto del dueño, Tab A9+, 2026-11-15): «Como cambio la llanta
 * de un carro» recibió tres veces una invención peligrosa («primero
 * asegúrate de que el motor esté en marcha») y «Que hago si un niño se
 * esta atragantando» otra invención servida como primeros auxilios. El
 * juez no falló: NUNCA VIO las fuentes. En el peldaño de emergencia de
 * la escalera (nCtx 1024) la reserva de generación por defecto (512)
 * más el núcleo irreducible llenan la ventana y el ajuste de
 * presupuesto sacrificaba TODAS las fuentes recuperadas; ChatScreen
 * juzga contra la lista ajustada, así que con la lista vacía ni el
 * juez ni la sustitución por texto seguro de salud llegaban a correr.
 * Clase nueva de la caza: «turno desfondado» — la respuesta llega al
 * usuario sin que el juez la haya visto porque la lista de fuentes del
 * turno quedó vacía DESPUÉS de recuperar.
 *
 * Esta regresión fija las tres puertas de la clase:
 *  D1 el ajuste nunca desaloja todas las fuentes de una lista no
 *     vacía sin reintentar con la reserva suelo (las fuentes mandan
 *     sobre el colchón de generación);
 *  D3 con la lista ajustada vacía, el juez y la puerta de salud juzgan
 *     contra la lista RECUPERADA (judgeChunkList);
 *  y el control: en ventana normal (2048) nada cambia, y con un núcleo
 *  irreducible de verdad el ajuste sigue devolviendo [] (sin fingir).
 */
import { describe, it, expect } from "vitest";
import { assembleChatMessages, judgeChunkList } from "./pure";
import { verifyGroundedAnswer } from "./grounding";
import { shouldSubstituteSafeText } from "../routing/emergencyGate";
import type { RetrievedChunk } from "./retrieve";

const GUIA_LLANTA =
  "Para cambiar la llanta de un carro, apaga el motor y pon el freno de estacionamiento en una superficie plana y firme. " +
  "Afloja las tuercas de la rueda con la llave de cruz sin quitarlas del todo. " +
  "Coloca el gato en el punto de apoyo indicado por el fabricante y levanta el carro hasta que la rueda quede libre. " +
  "Quita las tuercas y la llanta dañada, coloca la refacción y aprieta las tuercas en cruz, primero a mano y luego con la llave ya con el carro en el suelo.";

const GUIA_ATRAGANTAMIENTO =
  "Si un niño mayor de 1 año se atraganta y no puede toser, hablar ni respirar, llama al 911 de inmediato. " +
  "Ponte detrás del niño y dale 5 golpes firmes en la espalda, entre los omóplatos, con el talón de la mano. " +
  "Si el objeto no sale, haz 5 compresiones abdominales: puño cerrado sobre el ombligo, cubierto con la otra mano, tirando hacia adentro y hacia arriba. " +
  "Alterna 5 golpes en la espalda y 5 compresiones hasta que el objeto salga o llegue la ayuda.";

const RUIDO_EN =
  "The River Severn is the longest river in Great Britain, at about 220 miles. It rises in the Cambrian Mountains in mid Wales and flows through Shropshire, Worcestershire and Gloucestershire before emptying into the Bristol Channel near the Severn Estuary, which has the second highest tidal range in the world.";

function chunk(body: string, id: string): RetrievedChunk {
  return {
    chunkId: id,
    docId: id,
    title: id,
    body,
    score: 1,
    matchType: "hybrid",
  } as unknown as RetrievedChunk;
}

const PREGUNTA_LLANTA = "Como cambio la llanta de un carro";
const R1 =
  "Para cambiar la llanta de un carro, primero asegúrate de que el motor esté en marcha.";
const SISTEMA =
  "Eres NIDO, un asistente útil que funciona sin conexión en el teléfono del usuario. Respondes en el idioma del usuario, con claridad y sin inventar datos: si la información verificada que se te da no alcanza para responder, lo dices con franqueza. Cuando se te dan fragmentos de documentos locales, tu respuesta debe apoyarse en ellos y citarlos con su número entre corchetes. Nunca des instrucciones peligrosas.";

function ajusteDelTurno(
  nCtx: number,
  reserve: number,
  pregunta: string = PREGUNTA_LLANTA
): { fitted: RetrievedChunk[]; contenido: string } {
  const originales = [chunk(GUIA_LLANTA, "guia-llanta"), chunk(RUIDO_EN, "wiki-en")];
  // Como en ChatScreen: la lista del turno es la ajustada si el ajuste
  // corrió (onFitted), y la original si el prompt cabía sin ajustar.
  let fitted: RetrievedChunk[] = originales;
  const msgs = assembleChatMessages(
    pregunta,
    originales,
    SISTEMA,
    undefined,
    undefined,
    false,
    { nCtx, reserveGeneration: reserve },
    (f) => {
      fitted = f;
    }
  );
  return { fitted, contenido: msgs.map((m) => m.content).join("\n") };
}

describe("turno desfondado (0.1.102): el ajuste no puede desalojar todas las fuentes", () => {
  it("D1: a nCtx 1024 con la reserva por defecto, la guía SOBREVIVE al ajuste", () => {
    const { fitted, contenido } = ajusteDelTurno(1024, 512);
    expect(fitted.length).toBeGreaterThan(0);
    expect(contenido).toContain("freno de estacionamiento");
  });

  it("D1: con la lista ajustada que llega al juez, la invención de la foto se corta", async () => {
    const { fitted } = ajusteDelTurno(1024, 512);
    expect(fitted.length).toBeGreaterThan(0);
    const veredicto = await verifyGroundedAnswer(R1, fitted, "es", PREGUNTA_LLANTA);
    expect(veredicto.status).toBe("abstained");
  });

  it("control: a nCtx 2048 la guía ya sobrevivía y sigue sobreviviendo", () => {
    const { fitted, contenido } = ajusteDelTurno(2048, 512);
    expect(fitted.length).toBeGreaterThan(0);
    expect(contenido).toContain("freno de estacionamiento");
  });

  it("control: con un núcleo irreducible de verdad, el ensamblado muere honesto (lanza), no sirve invención", () => {
    // La pregunta nunca se recorta: un texto pegado por el usuario que
    // él solo llena la ventana no deja sitio ni con la reserva suelo;
    // el ensamblado lanza (la burbuja enseña el texto humano de la
    // categoría «contexto», ver userFacingError) en vez de generar sin
    // fuentes y servir la invención.
    const preguntaGigante = "Explica este texto: " + "palabra ".repeat(1500);
    expect(() => ajusteDelTurno(1024, 512, preguntaGigante)).toThrow();
  });
});

describe("turno desfondado: la lista del juez cuando el ajuste vació la del turno", () => {
  it("D3: judgeChunkList cae a la lista recuperada solo cuando la ajustada está vacía", () => {
    const recuperadas = [chunk(GUIA_LLANTA, "guia-llanta")];
    const ajustadas = [chunk(RUIDO_EN, "wiki-en")];
    expect(judgeChunkList([], recuperadas)).toBe(recuperadas);
    expect(judgeChunkList(ajustadas, recuperadas)).toBe(ajustadas);
    expect(judgeChunkList([], [])).toEqual([]);
  });

  it("D3: el atragantamiento inventado de la foto, juzgado contra la guía recuperada, dispara el texto seguro", async () => {
    const inventado =
      "Si un niño se atraganta, primero asegúrate de que esté tranquilo y relajado. Luego, haz lo siguiente: 1. Sólo si es seguro para ti, acuéstate al lado del niño. 2. Mantén la respiración calmada. 3. Si el niño continúa atragantándose o parece mareado, llama a un profesional de la salud inmediatamente.";
    const recuperadas = [chunk(GUIA_ATRAGANTAMIENTO, "guia-atragantamiento")];
    const listaJuez = judgeChunkList([], recuperadas);
    const veredicto = await verifyGroundedAnswer(inventado, listaJuez, "es", "Que hago si un niño se esta atragantando");
    expect(veredicto.status).not.toBe("verified");
    const sustituir = shouldSubstituteSafeText({
      sources: listaJuez,
      grounding: veredicto.status,
      provenance: veredicto.sentences,
      isHealth: true,
      isEmergency: true,
      deepTurn: false,
    });
    expect(sustituir).toBe(true);
  });
});
