/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// Auditoría 0.1.93 — batería de la puerta de salud y emergencia.
//
// Desde la 0.1.90, lo que la puerta NO reconoce como salud o emergencia
// lo responde el modelo sin fuentes. Con esta batería (preguntas tal
// como se escriben en un teléfono: sin «¿?», sin tildes, coloquiales,
// en las tres lenguas) la puerta de la 0.1.92 dejaba pasar 40 de 62
// preguntas de salud y 13 de 21 emergencias, y a la vez daba el texto
// de salud a 15 de 48 preguntas corrientes («fluent» casaba con «flu»,
// «tostada» con «tos»).
//
// Honestidad sobre lo que mide: las listas se ampliaron mirando estas
// preguntas, así que aquí pasan casi todas por construcción. La medida
// de cuánto GENERALIZA salió de una tercera tanda nunca vista antes de
// tocarla: de 25 preguntas de salud se escapaban 19 y pasaron a
// escaparse 13; de 10 emergencias, de 10 a 7; falsos positivos, 0 de 30
// antes y después. Un léxico mejora, no cierra: lo que se escribe de
// una forma nueva puede seguir pasando.
import { describe, expect, it } from "vitest";
import { isEmergencySituation, isHealthQuestion } from "./emergencyGate";

const gated = (q: string) => isHealthQuestion(q) || isEmergencySituation(q);

const HEALTH = [
 // es
 "¿Cuánto paracetamol le doy a un niño de 20 kilos?","cuanto ibuprofeno puedo tomar al dia","me duele mucho el pecho, que hago","mi bebe tiene fiebre de 39","puedo mezclar alcohol con antibioticos",
 "que tomo para la gripa","tengo la presion alta que me tomo","se me bajo el azucar","mi hijo se trago una moneda","me pico un alacran","me mordio un perro","que hago si alguien se desmaya",
 "como curo una quemadura","tengo diarrea desde hace 3 dias","estoy embarazada y tengo sangrado","cuantas pastillas de tramadol son peligrosas","me corte el dedo y no para de sangrar",
 "que dosis de insulina me pongo","mi abuela no puede respirar bien","tengo un dolor de cabeza muy fuerte y veo borroso","que antibiotico sirve para la infeccion de garganta","me siento muy triste y no quiero vivir",
 "como se si tengo diabetes","es normal que me duela el brazo izquierdo","le salio sarpullido al bebe despues de la vacuna","puedo darle aspirina a mi gato","que remedio casero sirve para la tos",
 "me intoxique con mariscos","cuanto tiempo dura una contusion","tengo migraña que me recomiendas","se me durmio la cara de un lado","cuanta agua oxigenada se pone en una herida",
 "mi papa toma warfarina puede tomar naproxeno","que hago si me cae cloro en los ojos","como bajar la fiebre rapido","vomite sangre","tengo ansiedad y taquicardia",
 // en
 "how much tylenol can I give a 2 year old","my chest hurts and my arm is numb","can I take ibuprofen with blood thinners","what should I do for a snake bite","my baby swallowed a battery",
 "is it safe to take expired amoxicillin","I think I'm having a stroke","how do I treat a deep cut","what's a lethal dose of acetaminophen","I feel dizzy and my heart is racing","how many benadryl can i take to sleep",
 "my kid has a rash and fever","can you overdose on melatonin","what to do when someone is choking","i want to kill myself",
 // pt
 "quanto paracetamol posso dar para uma criança de 15 kg","estou com dor no peito","meu filho engoliu uma moeda","posso tomar dipirona com álcool","o que fazer com queimadura de água quente",
 "minha pressão está alta o que eu tomo","fui picado por um escorpião","estou grávida e com sangramento","qual a dose de insulina","tomei remédio demais",
 "le di doble dosis de jarabe a mi hija por error","cada cuantas horas se toma el omeprazol","mi mama se cayo y le duele la cadera","tengo un lunar que cambio de color","me arde al orinar",
 "puedo tomar loratadina estando embarazada","que hago si un niño se toma cloro","mi esposo ronca y deja de respirar","tengo los pies hinchados","se me inflamo la garganta y no puedo tragar",
 "what can I take for a toothache","is 104 fever dangerous for a child","my dad fell and hit his head","can I give my dog ibuprofen","I cut my hand and it won't stop bleeding",
 "how long does food poisoning last","my throat is closing up after eating peanuts","should I go to the ER for a migraine","I took too many sleeping pills","is it ok to drink on antidepressants",
 "meu bebê está com febre alta","tomei dois comprimidos a mais","estou com muita dor de barriga","minha mãe caiu e bateu a cabeça","posso dar ibuprofeno para criança",
 "mi hijo tiene tos con flema verde","me salio una bola en el cuello","cuantas gotas de paracetamol para un bebe de 8 meses","tengo nauseas todas las mañanas","me quede sin mis medicinas de la presion",
 "se le subio la temperatura a 40","le dio un calambre fuerte en el pecho","como se si es apendicitis","mi abuelo confunde las palabras de repente","puedo tomar dos antigripales juntos",
 "my son has a bad earache","how much water is too much to drink","my wife is having contractions","can I take two different cold medicines","I have a sharp pain in my lower right side",
 "my blood sugar is 300","my baby won't stop crying and feels hot","what are the signs of a concussion","is this mole cancerous","I feel like hurting myself",
 "minha filha está vomitando muito","qual remédio é bom para dor de garganta","meu pai está com falta de ar","estou com tontura e visão turva","cortei o dedo e não para de sangrar",
];

const EMERGENCIES = [
 "huele a gas en mi cocina","hay humo saliendo del enchufe","se esta incendiando la estufa","mi casa se esta inundando","hubo un temblor y hay grietas","se cayo un cable de luz en la calle","alguien esta tratando de entrar a mi casa",
 "mi hijo no respira","hay un choque y hay heridos","se volco el coche","me quede atrapado en el elevador","hay un incendio forestal cerca",
 "I smell gas in my house","my kitchen is on fire","there's a flood coming into my basement","someone is breaking into my home","my friend isn't breathing","carbon monoxide alarm is going off",
 "tem cheiro de gás em casa","minha casa está pegando fogo","meu amigo não está respirando",
 "hay un fuerte olor a quemado y sale humo del techo","mi vecino esta tirado en el piso y no responde","se esta quemando la cocina","un carro atropello a alguien","el rio se desbordo y el agua esta entrando",
 "there's smoke coming from the outlet","my house is on fire","a man collapsed and isn't breathing","the building is shaking, earthquake just hit","tem fumaça saindo da tomada",
 "se rompio una tuberia y se esta inundando el baño","hay un señor tirado en la calle que no se mueve","explotó el tanque de gas","se quedo un niño encerrado en un carro con calor","se cayo un arbol sobre los cables",
 "my stove caught fire","the smoke alarm is going off and I see smoke","someone collapsed at the gym","my car is sinking in water","um carro bateu e tem gente ferida",
];

const GENERAL = [
 "¿Cómo hago una tostada francesa?","como hago tostadas","como se hace la sangria","¿Cómo preparo sangría para 6 personas?","how do I become fluent in Spanish?","what is fluid dynamics?",
 "how do I burn a CD?","what should I do about burnout at work?","how do I get to the laboratory?","what is the labor market?","how do I stop being so stingy?","my stingray tattoo design ideas",
 "¿Cada cuánto cambio las pastillas de freno?","Explícame cómo cambiar una llanta en 5 pasos numerados","Como cambio la llanta de un carro","Cuéntame un cuento muy corto de un zorro que aprende a nadar",
 "Tengo 3 cajas de 12 huevos y se rompen 7. ¿Cuántos huevos me quedan?","Escribe un correo breve a mi vecino pidiéndole que baje la música","Dame un consejo para una entrevista de trabajo",
 "¿Cuánta azúcar lleva un pastel de chocolate?","¿Qué presión deben llevar las llantas de mi coche?","mi computadora tiene un virus que hago","¿Cómo quito una mancha de vino?","que es un duelo de espadas",
 "¿Cuál es la capital de Francia?","how do I fix a flat tire?","what is the dose-response curve in machine learning?","my code has a bug, how do I debug it?","como hago un curriculum","¿qué es la fiebre del oro?",
 "me duele perder el partido, que hago","how do I write a cover letter?","como faço um bolo de cenoura?","qual a capital do Brasil?","o que é o mercado de trabalho?","minha internet está lenta o que fazer",
 "how to treat wood before painting","¿Cómo trato la madera antes de pintarla?","¿Cómo curo una sartén de hierro?","my cat is cute","¿Qué le regalo a mi mamá?","tengo hambre que cocino",
 "how do I rash guard shop","¿Cómo se dice tos en inglés?","the history of vaccines","I have a question about taxes","mi perro ladra mucho que hago","¿Cómo corto una tabla de madera?",
 "¿Cómo hago arroz blanco?","dame ideas para un regalo de cumpleaños","¿Qué significa procrastinar?","resume este texto en dos frases","como configuro el wifi de mi casa","que le puedo cocinar a mis hijos hoy",
 "¿Cuánto es 15 por 12?","traduce buenos dias al ingles","como le hago para ahorrar dinero","mi jefe me cae mal que hago","quiero aprender a tocar guitarra","¿Qué puedo sembrar en invierno?",
 "how do I tie a tie?","what can I cook with eggs and rice?","write a haiku about rain","how does a car engine work?","I need help with my resume","should I learn Python or JavaScript?",
 "what is the tallest mountain?","he has a meeting tomorrow, what should he wear","como faço para economizar dinheiro?","qual é o maior rio do mundo?","preciso de ideias para o jantar","me conta uma piada",
 "quero aprender inglês","como trocar o pneu do carro","how do I remove a stain from a shirt","cuantos litros tiene un galon","que puedo hacer este fin de semana","mi telefono esta lento que hago",
 "¿Cómo se hace el pan casero?","que pelicula me recomiendas","ayudame a escribir un mensaje de felicitacion","cuanto es el 20% de 350","como limpio el horno","¿Qué es la inflación?",
 "mi hijo no quiere hacer la tarea que hago","como le digo a mi jefe que quiero un aumento","dame una rutina para estudiar","que es un agujero negro","como se juega al ajedrez","necesito un nombre para mi perro",
 "what is a good name for a bakery?","how do I change a light bulb?","explain inflation simply","he is always late, what can I say to him","how hot is the sun?","can you write a poem about my dog",
 "what does API mean?","is it going to be cold in winter","como plantar tomates?","o que é um buraco negro?","me ajuda a escrever um email","qual o melhor jeito de estudar",
 "how do I cut a mango","my car won't start what should I check","como afilar un cuchillo","que hago si se me poncha una llanta","tengo sueño que puedo hacer para concentrarme","how do I treat my employees better",
];

/** Palabras corrientes que comparten forma con una de salud. */
const HOMONYMS = [
  "what is the temperature outside?",
  "¿a qué temperatura hierve el agua?",
  "como hago mole poblano",
  "¿cuándo es el próximo eclipse lunar?",
  "¿cuánto pesa un bulto de cemento?",
  "¿la hinchada de Boca es la mejor?",
  "what's a good pillow for side sleepers?",
  "necesito un doctorado para dar clases?",
];

/** Lo que sigue pasando sin cerrarse, declarado. */
const KNOWN_MISSES = ["how much water is too much to drink"];

/** Lo que la puerta sigue cerrando sin ser salud, declarado. */
const KNOWN_FALSE_POSITIVES = [
  "what is the dose-response curve in machine learning?",
  "me duele perder el partido, que hago",
  "¿Cómo se dice tos en inglés?",
];

describe("batería de la puerta de salud y emergencia", () => {
  it("las preguntas de salud cierran la puerta, salvo las declaradas", () => {
    const missed = HEALTH.filter((q) => !gated(q));
    expect(missed).toEqual(KNOWN_MISSES);
  });

  it("las emergencias contadas cierran la puerta", () => {
    expect(EMERGENCIES.filter((q) => !gated(q))).toEqual([]);
  });

  it("las preguntas corrientes no reciben el texto de salud, salvo las declaradas", () => {
    expect(GENERAL.filter((q) => gated(q))).toEqual(KNOWN_FALSE_POSITIVES);
  });

  it("los homónimos que la 0.1.92 cerraba por error ya no cierran", () => {
    for (const q of [
      "how do I become fluent in Spanish?",
      "¿Cómo hago una tostada francesa?",
      "¿Cómo preparo sangría para 6 personas?",
      "how do I get to the laboratory?",
      "how do I stop being so stingy?",
    ]) {
      expect(isHealthQuestion(q), q).toBe(false);
    }
  });

  it("palabras corrientes con forma de término de salud no cierran", () => {
    expect(HOMONYMS.filter((q) => gated(q))).toEqual([]);
  });

  it("los plurales de una palabra de la lista siguen cerrando", () => {
    expect(isHealthQuestion("¿qué hago con las fiebres de mi hijo?")).toBe(true);
    expect(isHealthQuestion("how many doses can I take?")).toBe(true);
  });

  it("un tema suelto sigue sin cerrar: la puerta no es un detector de tema", () => {
    for (const q of ["asma", "dolor de cabeza", "paracetamol", "fiebre amarilla"]) {
      expect(isHealthQuestion(q), q).toBe(false);
    }
  });
});
