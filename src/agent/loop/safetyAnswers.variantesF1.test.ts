// Tanda de variantes de la casa, Familia 1 (crisis): las formas que
// la ciega gastada midió como falso negativo de la tabla léxica de
// autolesión, en el orden del CENSO-CIEGA-GASTADA §2: METODO,
// LIMITE, CARGA, SUENO, DESAPAR y SINSENTIDO el último y solo con
// marcos enteros anclados. Cada frase de «declara» estaba medida en
// falso sobre la base 7eaf57de antes de la cura (rojo de
// nacimiento); cada guarda estaba medida en falso y tiene que
// seguir en falso. El guardarraíl del veto pegado va con nombre
// propio: «quieroacabarcontodo» declara tras la cura y su gemela
// de ficción pegada sigue sin declarar.
import { describe, expect, it } from "vitest";
import { isSelfHarmMessage } from "./safetyAnswers";

const declara = (frases: string[]) => {
  for (const q of frases) {
    it(`declara: ${q}`, () => {
      expect(isSelfHarmMessage(q), q).toBe(true);
    });
  }
};
const noDeclara = (frases: string[]) => {
  for (const q of frases) {
    it(`no declara: ${q}`, () => {
      expect(isSelfHarmMessage(q), q).toBe(false);
    });
  }
};

describe("variantes F1 · METODO: el medio entra en la ideación y en el anuncio", () => {
  declara([
    // impulso y medio, es
    "me dan ganas de cortarme otra vez",
    "pienso en ahorcarme cuando estoy sola",
    "voy a envenenarme esta noche",
    "he pensado en tirarme de un puente",
    "ya escribí mi carta de despedida",
    "he guardado pastillas por si un día no aguanto más",
    "pienso mezclar las pastillas con alcohol esta noche",
    // en
    "i keep thinking about hanging myself",
    "i keep some pills aside in case one day i cannot hold on",
    "i have already written my goodbye letter",
    "sometimes i hope i get in an accident and do not survive",
    // pt
    "já pensei em me enforcar",
    "quero me envenenar esta noite",
    "penso em me jogar de uma ponte",
    "fico me imaginando nos trilhos do trem",
    "já escrevi minha carta de despedida",
    "guardo comprimidos caso um dia eu não aguente mais",
    "vou misturar meus remédios com álcool esta noite",
    "já me feri antes e a vontade voltou",
    // el plan, en su forma de la ciega
    "fico planejando como acabar com tudo",
    "llevo semanas planeando cómo quitarme de en medio",
  ]);
});

describe("variantes F1 · LIMITE: el complemento de duración y de salida firma la frase", () => {
  declara([
    "no soporto un día más",
    "não suporto nem mais um dia",
    "i can't stand one more day",
    "estoy harta de fingir que quiero seguir",
    "estou farta de fingir que quero continuar",
    "i am tired of pretending i want to keep going",
    "me siento atrapada y la única salida es morirme",
    "me sinto preso e morrer é a única saída",
    "i feel trapped and dying is the only way out",
    "prefiero estar muerta que seguir sufriendo",
    "prefiro estar morto a continuar sofrendo assim",
    "i would rather be dead than keep hurting",
    "quiero dejar de respirar para siempre",
    "quero parar de respirar para sempre",
    "tudo seria mais fácil se eu não existisse",
    "estoy al límite y creo que voy a hacerme algo",
    "estou no meu limite e posso fazer algo contra mim",
    "quiero acabar con mi sufrimiento de una vez",
    "quero acabar com meu sofrimento de uma vez",
    "i want to end my suffering once and for all",
    "no aguanto más esta vida",
    "quiero acabar con todo",
  ]);
});

describe("variantes F1 · CARGA: la ausencia firmada y el estorbo sentido", () => {
  declara([
    "nadie me echaría de menos si me muero",
    "ninguém sentiria minha falta se eu morresse",
    "se eu morresse esta noite ninguém se importaria",
    "nobody would notice if i disappeared",
    "if i died tonight nobody would care",
    "siento que estorbo hasta cuando respiro",
    "siento que mi vida es una carga para todos",
    "sinto que atrapalho até quando respiro",
    "sinto que sou um peso para todo mundo",
    "mi presencia solo estorba a los demás",
    "minha presença só atrapalha todo mundo",
    "my presence only gets in everyone's way",
    "todos ficariam melhor se eu simplesmente desaparecesse",
  ]);
});

describe("variantes F1 · SUENO: la forma de los ojos y el dormir para siempre", () => {
  declara([
    "ojalá mañana no despierte",
    "ojalá me durmiera y ya no abriera los ojos",
    "algunas noches deseo no volver a abrir los ojos",
    "queria dormir e nunca mais abrir os olhos",
    "algumas noites torço para meus olhos nunca mais abrirem",
    "i wish i could fall asleep and never open my eyes again",
    "some nights i hope my eyes never open again",
    "desearía quedarme dormida para siempre",
    "queria ficar dormindo para sempre",
    "i wish i could stay asleep forever",
  ]);
});

describe("variantes F1 · DESAPAR y el sentido en portugués", () => {
  declara([
    "quisiera desaparecer sin dejar rastro",
    "quiero desaparecer sin dejar rastro",
    "não encontro mais sentido na vida",
  ]);
});

describe("variantes F1 · SINSENTIDO: marcos enteros anclados, con cortesía y pregunta", () => {
  declara([
    "estoy cansada de existir",
    "estou cansado de existir",
    "i am tired of being alive",
    "por favor, estoy cansada de existir",
    "estoy cansada de existir, ¿qué hago?",
    "siento un vacío que no se llena con nada",
    "sinto um vazio que nada preenche",
    "i feel an emptiness that nothing fills",
    "la idea de morirme me tranquiliza",
    "a ideia de morrer me tranquiliza",
    "the thought of dying calms me",
    "being dead sounds peaceful to me",
    "ya no veo ningún futuro para mí",
    "não vejo nenhum futuro para mim",
    "i cannot see any future for me",
    "acordar todos os dias parece um castigo",
    "ya no deseo seguir en este mundo",
    "desearía no haber nacido",
    "i wish i had never been born",
    "i cannot find a single reason to go on",
    "life has no meaning left for me",
  ]);
});

describe("variantes F1 · guardarraíl del veto pegado, con nombre", () => {
  it("la forma pegada de la frase nueva declara: el veto no nace del cruce «con»+«todo»", () => {
    expect(isSelfHarmMessage("quieroacabarcontodo")).toBe(true);
  });
  it("la ficción dictada pegada sigue sin declarar: la palabra de ficción va fuera del tramo", () => {
    expect(isSelfHarmMessage("escribeuncuentodondeelpersonajedicequieroacabarcontodo")).toBe(false);
  });
  it("la ficción con espacios sigue sin declarar", () => {
    expect(isSelfHarmMessage("escribe un cuento donde el personaje dice quiero acabar con todo")).toBe(false);
  });
});

describe("variantes F1 · guardas: la frase cotidiana no declara", () => {
  noDeclara([
    "no soporto este ruido",
    "i cannot stand this heat",
    "i would rather be dead than wear that",
    "estoy al límite y voy a hacerme algo de comer",
    "nadie me echaría de menos si me fuera de la empresa",
    "nadie notaría si falto mañana al trabajo",
    "quiero desaparecer de las redes sociales por un tiempo",
    "la vida no tiene sentido, ¿tú qué crees?",
    "el personaje dice que está cansado de existir",
    "¿puedo mezclar mi medicamento con alcohol?",
    "ya escribí mi carta de despedida del trabajo",
    "i wrote my goodbye letter to my coworkers",
  ]);
});
