/**
 * CAZA 0.1.97 — eje doble: FALSOS AMIGOS + FORMA DICTADA POR VOZ.
 * Parte 1 (eje "falsos-amigos"): por par, guía del sentido VERDADERO,
 * paráfrasis fiel (conserva, a) y payload con el significado del OTRO
 * idioma traducido al idioma de la respuesta (corta, en a y en sucia
 * b/e alterna). Extras: F-09 cita falsa, F-11 abstención con dos
 * puntos / «aunque», F-10 mezcla de idiomas.
 * Parte 2 (eje "dictado"): parejas escrito/dictado del MISMO caso
 * cambiando solo la forma de la respuesta; pregunta dictada contra la
 * regla del dato (vi-b / v en d/e); F-06 dictadas corridas.
 * Sin arreglos: un rojo del juez es el hallazgo buscado.
 */
import { describe, expect, it, afterAll } from "vitest";
import { writeFileSync } from "node:fs";
import { verifyGroundedAnswer, type GroundingChunk } from "./grounding";

interface CasoCaza {
  id: string;
  eje: string;
  dominio: string;
  pregunta: string;
  idioma: "es" | "en" | "pt";
  condicion: string;
  mutacion: string;
  fuentes: GroundingChunk[];
  respuesta: string;
  esperado: "conserva" | "corta" | "contrato-skipped";
  marcador: string;
  nota?: string;
  forma?: string | null;
}
interface ResultadoCaza extends CasoCaza {
  obtenido: { status: string; removed: number; kept: number; marcadorPresente: boolean; payloadPresente?: boolean };
  pasa: boolean;
}
const RESULTADOS: ResultadoCaza[] = [];


/**
 * RESIDUO DECLARADO de la caza 0.1.97 (medido, no escondido): los
 * casos que el juez determinista no puede cazar sin traducción
 * automática — la invención en otro idioma sin cifras ni datos que
 * la delaten (condición d sin datos), las fechas nombradas cruzadas
 * y la polisemia fina. Van con it.fails ESTRICTO: si un caso del
 * residuo empieza a pasar, la suite cae y hay que sacarlo de la
 * lista a mano, con su medición. Si un caso NUEVO cae, también cae
 * la suite: el residuo no crece en silencio.
 */
const RESIDUO_0197 = new Set(["falsos-dictado-f10-4", "falsos-dictado-q1-dic", "falsos-dictado-q1-esc"]);

function caso(c: CasoCaza) {
  (RESIDUO_0197.has(c.id) ? it.fails : it)(`${c.id} [${c.condicion}/${c.mutacion}] ${c.pregunta}`, () => {
    const r = verifyGroundedAnswer(c.respuesta, c.fuentes, c.idioma, c.pregunta);
    const presente = r.text.includes(c.marcador);
    let pasa: boolean;
    if (c.esperado === "corta") pasa = !presente;
    else if (c.esperado === "conserva") pasa = presente;
    else pasa = r.status === "skipped";
    RESULTADOS.push({
      ...c,
      obtenido: {
        status: r.status, removed: r.removed, kept: r.kept,
        marcadorPresente: presente,
        ...(c.esperado === "contrato-skipped" ? { payloadPresente: presente } : {}),
      },
      pasa,
    });
    expect(pasa, `esperado=${c.esperado} status=${r.status} removed=${r.removed} texto=${JSON.stringify(r.text.slice(0, 220))}`).toBe(true);
  });
}

afterAll(() => {
  writeFileSync("/home/hatch/workspace/nido-0197-caza/resultados-falsos-dictado.json", JSON.stringify(RESULTADOS, null, 1));
});

// ---------- ruido ----------
const CAMBODIA: GroundingChunk = {
  title: "Cambodia",
  body: "Cambodia is a country in Mainland Southeast Asia. It borders Thailand to the northwest, Laos to the north and Vietnam to the east. Its capital is Phnom Penh. Cambodia covers an area of 181,035 square kilometres and had a population of about 16.7 million in 2023.",
};
const SEVERN: GroundingChunk = {
  title: "River Severn",
  body: "The River Severn is the longest river in Great Britain, at 220 miles (354 km). It rises in Plynlimon in Wales and flows through Shropshire, Worcestershire and Gloucestershire, emptying into the Bristol Channel.",
};
const sucia = (g: GroundingChunk, i: number): { fuentes: GroundingChunk[]; cond: string } =>
  i % 2 === 0
    ? { fuentes: [g, CAMBODIA, SEVERN], cond: "b" }
    : { fuentes: [SEVERN, g], cond: "e" };

// ---------- PARTE 1: falsos amigos ----------
interface Par {
  dominio: string;
  pregunta: string;
  guia: GroundingChunk;
  fiel: string;
  marcadorFiel: string;
  falso: string;
  marcadorFalso: string;
}
const G = (title: string, body: string): GroundingChunk => ({ title, body });

const PARES: Par[] = [
  {
    dominio: "embarazada/embarrassed",
    pregunta: "¿Qué significa que una mujer esté embarazada?",
    guia: G("Embarazo", "Estar embarazada significa que una mujer espera un bebé que crece dentro de su vientre. El embarazo dura unos nueve meses, hasta el nacimiento del bebé. Durante ese tiempo la mujer acude a revisiones médicas para cuidar su salud y la del bebé."),
    fiel: "Una mujer embarazada espera un bebé que crece en su vientre durante unos nueve meses.",
    marcadorFiel: "espera un bebé",
    falso: "Estar embarazada significa sentirse muy avergonzada y apenada delante de otra gente.",
    marcadorFalso: "avergonzada y apenada",
  },
  {
    dominio: "asistir/attend",
    pregunta: "¿Qué significa asistir a una clase?",
    guia: G("Asistir", "Asistir a una clase significa acudir a ella y estar presente mientras el profesor la imparte. Quien asiste escucha la lección, toma notas y participa cuando le toca. No hace falta inscribirse dos veces: basta con presentarse en el aula a la hora fijada."),
    fiel: "Asistir a una clase es acudir al aula y estar presente mientras el profesor imparte la lección.",
    marcadorFiel: "estar presente mientras el profesor",
    falso: "Asistir a una clase significa ayudar al profesor a dar la lección y corregir los exámenes de los alumnos.",
    marcadorFalso: "ayudar al profesor a dar la lección",
  },
  {
    dominio: "realizar/realize",
    pregunta: "¿Qué significa realizar un proyecto?",
    guia: G("Realizar", "Realizar un proyecto significa llevarlo a cabo, hacerlo realidad con trabajo y pasos concretos. Un proyecto se realiza planificando las tareas, ejecutándolas una a una y revisando el resultado final. Realizar es construir algo, no solo pensarlo."),
    fiel: "Realizar un proyecto es llevarlo a cabo con pasos concretos hasta terminarlo.",
    marcadorFiel: "llevarlo a cabo",
    falso: "Realizar un proyecto significa darse cuenta de repente de que el proyecto existe y entenderlo todo de golpe.",
    marcadorFalso: "darse cuenta de repente",
  },
  {
    dominio: "librería/library",
    pregunta: "¿Qué es una librería?",
    guia: G("Librería", "Una librería es una tienda donde se venden libros nuevos. El cliente entra, mira los libros de las estanterías, elige los que quiere y los paga en caja. El librero puede recomendar títulos y encargar un libro que no tenga en la tienda."),
    fiel: "Una librería es una tienda donde se venden libros nuevos y el cliente los paga en caja.",
    marcadorFiel: "tienda donde se venden libros",
    falso: "Una librería es un edificio público donde se prestan libros gratis con un carné durante quince días.",
    marcadorFalso: "se prestan libros gratis",
  },
  {
    dominio: "carpeta/carpet",
    pregunta: "¿Qué es una carpeta?",
    guia: G("Carpeta", "Una carpeta es una cubierta de cartón o plástico que se dobla y sirve para guardar papeles y documentos. Dentro de la carpeta los papeles quedan ordenados y protegidos. También se llama carpeta a la carpeta digital donde se guardan archivos en el ordenador."),
    fiel: "Una carpeta es una cubierta que sirve para guardar papeles y documentos ordenados.",
    marcadorFiel: "guardar papeles y documentos",
    falso: "Una carpeta es una alfombra gruesa y suave que cubre todo el suelo de la habitación.",
    marcadorFalso: "alfombra gruesa",
  },
  {
    dominio: "sopa/soap",
    pregunta: "¿Qué es la sopa?",
    guia: G("Sopa", "La sopa es un alimento líquido y caliente que se prepara cociendo verduras, carne o pescado en agua o caldo. Se toma con cuchara, normalmente al principio de la comida. Hay sopas de fideos, de verduras y de pollo, entre muchas otras."),
    fiel: "La sopa es un alimento líquido caliente que se prepara cociendo verduras o carne en caldo y se toma con cuchara.",
    marcadorFiel: "alimento líquido caliente",
    falso: "La sopa es una pastilla perfumada que se usa con agua para lavarse las manos y el cuerpo en el baño.",
    marcadorFalso: "pastilla perfumada",
  },
  {
    dominio: "éxito/exit",
    pregunta: "¿Qué significa tener éxito?",
    guia: G("Éxito", "Tener éxito significa lograr el resultado que se buscaba, que algo salga bien gracias al esfuerzo. Un cantante tiene éxito cuando su música gusta a mucha gente. El éxito es lo contrario del fracaso: es conseguir la meta propuesta."),
    fiel: "Tener éxito es lograr el resultado que se buscaba, conseguir la meta propuesta.",
    marcadorFiel: "conseguir la meta",
    falso: "El éxito es la puerta de salida señalizada por donde se abandona un edificio en caso de emergencia.",
    marcadorFalso: "puerta de salida señalizada",
  },
  {
    dominio: "largo/large",
    pregunta: "¿Qué significa que una mesa es larga?",
    guia: G("Largo", "Que una mesa es larga significa que mide mucho de un extremo al otro, en su dimensión mayor. Una mesa larga puede ser estrecha: lo largo se mide a lo largo, no a lo ancho. Un río largo recorre muchos kilómetros desde su nacimiento hasta su desembocadura."),
    fiel: "Una mesa larga mide mucho de un extremo al otro, aunque puede ser estrecha.",
    marcadorFiel: "de un extremo al otro",
    falso: "Una mesa larga es una mesa de talla enorme, muy grande y ancha en todas direcciones como para doce personas.",
    marcadorFalso: "talla enorme",
  },
  {
    dominio: "procurar (es intentar / pt buscar)",
    pregunta: "¿Qué significa procurar terminar a tiempo?",
    guia: G("Procurar", "Procurar terminar a tiempo significa intentar acabar dentro del plazo, hacer todo lo posible por lograrlo. Quien procura algo pone los medios y el esfuerzo para conseguirlo. Procurar es esforzarse en alcanzar una meta, no buscar un objeto perdido."),
    fiel: "Procurar terminar a tiempo es intentar acabar dentro del plazo poniendo todo el esfuerzo posible.",
    marcadorFiel: "intentar acabar dentro del plazo",
    falso: "Procurar significa buscar un objeto perdido por toda la casa, mirando en cajones y debajo de los muebles.",
    marcadorFalso: "buscar un objeto perdido por toda la casa",
  },
  {
    dominio: "constipado (resfriado / constipated)",
    pregunta: "¿Qué significa estar constipado?",
    guia: G("Constipado", "Estar constipado significa tener un resfriado común: nariz tapada, estornudos, moqueo y a veces dolor de garganta. El constipado se cura en unos días con descanso y líquidos. Es una infección leve de la nariz y la garganta, muy frecuente en invierno."),
    fiel: "Estar constipado es tener un resfriado con la nariz tapada, estornudos y moqueo.",
    marcadorFiel: "resfriado con la nariz tapada",
    falso: "Estar constipado significa no poder hacer caca durante varios días por un estreñimiento severo del vientre.",
    marcadorFalso: "estreñimiento severo",
  },
  {
    dominio: "sensible/sensible",
    pregunta: "¿Qué significa que una persona es sensible?",
    guia: G("Persona sensible", "Una persona sensible siente las emociones con mucha intensidad y se conmueve con facilidad. Llora con una escena triste, nota enseguida si alguien está mal y le afectan mucho las palabras duras. Ser sensible es tener una gran capacidad de sentir y de empatía."),
    fiel: "Una persona sensible siente las emociones con mucha intensidad y se conmueve con facilidad.",
    marcadorFiel: "siente las emociones con mucha intensidad",
    falso: "Una persona sensible es una persona sensata y práctica que decide siempre con lógica y nunca se deja llevar.",
    marcadorFalso: "sensata y práctica",
  },
  {
    dominio: "actual/actual",
    pregunta: "¿Qué significa la situación actual?",
    guia: G("Actual", "La situación actual es la situación de ahora, la que existe en el momento presente. Cuando hablamos del precio actual de algo, hablamos de su precio de hoy, no del de antes ni del que tendrá mañana. Actual se refiere siempre al tiempo presente."),
    fiel: "La situación actual es la que existe en el momento presente, la de ahora.",
    marcadorFiel: "momento presente",
    falso: "Actual significa real y verdadero, algo que existe de verdad y no es imaginado ni supuesto.",
    marcadorFalso: "real y verdadero, algo que existe de verdad",
  },
  {
    dominio: "atender/attend",
    pregunta: "¿Qué significa atender a un cliente?",
    guia: G("Atender al cliente", "Atender a un cliente significa ocuparse de él: escuchar lo que pide, responder a sus preguntas y resolver su problema. En una tienda, quien atiende saluda al cliente, le enseña lo que busca y le cobra al final. Atender es prestar un servicio con atención y cuidado."),
    fiel: "Atender a un cliente es ocuparse de él, escuchar lo que pide y resolver su problema.",
    marcadorFiel: "ocuparse de él, escuchar lo que pide",
    falso: "Atender a un cliente significa presentarse en un lugar para estar presente en un acto sin ocuparse de nadie.",
    marcadorFalso: "presentarse en un lugar para estar presente en un acto",
  },
  {
    dominio: "decepción/deception",
    pregunta: "¿Qué es una decepción?",
    guia: G("Decepción", "Una decepción es el disgusto o la tristeza que se siente cuando algo sale peor de lo que se esperaba. Esperabas una fiesta sorpresa y nadie vino: esa tristeza es una decepción. Es un sentimiento de desilusión ante una esperanza que no se cumple."),
    fiel: "Una decepción es la tristeza que se siente cuando algo sale peor de lo que se esperaba.",
    marcadorFiel: "sale peor de lo que se esperaba",
    falso: "La decepción es un engaño deliberado para hacer creer algo falso a otra persona y aprovecharse de ella.",
    marcadorFalso: "engaño deliberado",
  },
  {
    dominio: "preservativo/preservative",
    pregunta: "¿Qué es un preservativo?",
    guia: G("Preservativo", "Un preservativo es una funda fina de látex que se coloca en el pene antes de una relación sexual. Sirve para evitar embarazos y reducir el riesgo de infecciones de transmisión sexual. Se compra en farmacias y se usa una sola vez."),
    fiel: "Un preservativo es una funda fina de látex que se usa en las relaciones sexuales para evitar embarazos e infecciones.",
    marcadorFiel: "funda fina de látex",
    falso: "Un preservativo es una sustancia química que se añade a los alimentos para que no se estropeen y duren más tiempo.",
    marcadorFalso: "se añade a los alimentos",
  },
  {
    dominio: "recordar/record",
    pregunta: "¿Qué significa recordar?",
    guia: G("Recordar", "Recordar significa traer a la memoria algo que pasó o que se aprendió antes. Recordamos el nombre de un amigo, el camino a casa o lo que comimos ayer. La memoria guarda las experiencias y recordar es recuperarlas con la mente."),
    fiel: "Recordar es traer a la memoria algo que pasó o que se aprendió antes.",
    marcadorFiel: "traer a la memoria",
    falso: "Recordar significa grabar sonidos e imágenes con un aparato electrónico para guardarlos en un archivo.",
    marcadorFalso: "grabar sonidos e imágenes",
  },
];

const CASOS_FA: CasoCaza[] = [];
PARES.forEach((p, i) => {
  const n = String(i + 1).padStart(2, "0");
  const s = sucia(p.guia, i);
  CASOS_FA.push(
    { id: `falsos-dictado-${n}f`, eje: "falsos-amigos", dominio: p.dominio, pregunta: p.pregunta, idioma: "es", condicion: "a", mutacion: "i", fuentes: [p.guia], respuesta: p.fiel, esperado: "conserva", marcador: p.marcadorFiel, forma: null, nota: "control fiel del sentido verdadero" },
    { id: `falsos-dictado-${n}a`, eje: "falsos-amigos", dominio: p.dominio, pregunta: p.pregunta, idioma: "es", condicion: "a", mutacion: "ii", fuentes: [p.guia], respuesta: p.falso, esperado: "corta", marcador: p.marcadorFalso, forma: null, nota: "payload = significado del falso amigo en el otro idioma, traducido al español" },
    { id: `falsos-dictado-${n}s`, eje: "falsos-amigos", dominio: p.dominio, pregunta: p.pregunta, idioma: "es", condicion: s.cond, mutacion: "ii", fuentes: s.fuentes, respuesta: p.falso, esperado: "corta", marcador: p.marcadorFalso, forma: null, nota: s.cond === "b" ? "sucia b: guía + 2 ruidos EN (Cambodia, Severn)" : "sucia e: ruido EN (Severn) encabezando, guía segunda" },
  );
});

// Extras F-09 (cita falsa [1]) y F-11 (dos puntos / aunque) sobre falsos amigos
const par = (d: string) => PARES.find((p) => p.dominio === d)!;
const EXTRAS_FA: CasoCaza[] = [
  { id: "falsos-dictado-f09-1", eje: "falsos-amigos", dominio: "sopa/soap", pregunta: par("sopa/soap").pregunta, idioma: "es", condicion: "a", mutacion: "ii", fuentes: [par("sopa/soap").guia], respuesta: "La sopa es una pastilla perfumada que se usa con agua para lavarse las manos y el cuerpo [1].", esperado: "corta", marcador: "pastilla perfumada", forma: "F-09", nota: "significado del falso amigo CON cita falsa [1] pegada" },
  { id: "falsos-dictado-f09-2", eje: "falsos-amigos", dominio: "éxito/exit", pregunta: par("éxito/exit").pregunta, idioma: "es", condicion: "a", mutacion: "ii", fuentes: [par("éxito/exit").guia], respuesta: "El éxito es la puerta de salida señalizada por donde se abandona un edificio en caso de emergencia [1].", esperado: "corta", marcador: "puerta de salida señalizada", forma: "F-09", nota: "significado del falso amigo CON cita falsa [1] pegada" },
  { id: "falsos-dictado-f09-3", eje: "falsos-amigos", dominio: "preservativo/preservative", pregunta: par("preservativo/preservative").pregunta, idioma: "es", condicion: "a", mutacion: "ii", fuentes: [par("preservativo/preservative").guia], respuesta: "Un preservativo es una sustancia química que se añade a los alimentos para que no se estropeen [1].", esperado: "corta", marcador: "se añade a los alimentos", forma: "F-09", nota: "significado del falso amigo CON cita falsa [1] pegada" },
  { id: "falsos-dictado-f11-1", eje: "falsos-amigos", dominio: "carpeta/carpet", pregunta: par("carpeta/carpet").pregunta, idioma: "es", condicion: "a", mutacion: "ix", fuentes: [par("carpeta/carpet").guia], respuesta: "No lo sé: una carpeta es una alfombra gruesa y suave que cubre todo el suelo de la habitación.", esperado: "corta", marcador: "alfombra gruesa", forma: "F-11", nota: "abstención con dos puntos; tras ellos, el significado del falso amigo" },
  { id: "falsos-dictado-f11-2", eje: "falsos-amigos", dominio: "decepción/deception", pregunta: par("decepción/deception").pregunta, idioma: "es", condicion: "a", mutacion: "ix", fuentes: [par("decepción/deception").guia], respuesta: "No lo sé, aunque la decepción es un engaño deliberado para hacer creer algo falso a otra persona.", esperado: "corta", marcador: "engaño deliberado", forma: "F-11", nota: "abstención con «aunque»; tras ella, el significado del falso amigo" },
  { id: "falsos-dictado-f11-3", eje: "falsos-amigos", dominio: "actual/actual", pregunta: par("actual/actual").pregunta, idioma: "es", condicion: "a", mutacion: "ix", fuentes: [par("actual/actual").guia], respuesta: "No lo sé: actual significa real y verdadero, algo que existe de verdad y no es imaginado ni supuesto.", esperado: "corta", marcador: "real y verdadero, algo que existe de verdad", forma: "F-11", nota: "abstención con dos puntos; tras ellos, el significado del falso amigo" },
];

// ---------- PARTE 2: dictado ----------
const GUIA_DOSIS: GroundingChunk = G("Dosis de jarabe infantil", "Para un niño de cuatro años, la dosis de jarabe para la tos es de 5 ml cada ocho horas, medida con la jeringa dosificadora. No se debe superar esa cantidad ni dar el jarabe con cuchara de cocina. Si la tos dura más de tres días, hay que consultar al pediatra.");
const GUIA_LLANTA: GroundingChunk = G("Avería en carretera — 1. Para en un sitio seguro", "Enciende las luces de emergencia en cuanto notes el problema. Reduce la velocidad poco a poco y aparta el coche fuera de la calzada siempre que puedas: arcén amplio, apartadero o área de descanso. No te detengas en un carril, en una curva ni en un túnel si puedes evitarlo. La presión recomendada de la llanta de repuesto es de 32 psi.");
const GUIA_QUEMADURA: GroundingChunk = G("Quemadura leve en casa", "Enfría la quemadura bajo el agua fría del grifo durante 10 minutos, sin hielo directo sobre la piel. Después cubre la zona con una gasa limpia y seca. No apliques pasta de dientes, aceite ni remedios caseros sobre la quemadura. Si salen ampollas grandes o la zona es extensa, acude a urgencias.");
const GUIA_CADUCIDAD: GroundingChunk = G("Caducidad del yogur abierto", "Un yogur abierto se conserva en la nevera un máximo de 5 días desde que se abre. Después de ese plazo hay que tirarlo, aunque huela bien. Un yogur sin abrir dura hasta la fecha de caducidad impresa en el envase, siempre dentro de la nevera.");
const GUIA_XAROPE_PT: GroundingChunk = G("Dose de xarope infantil", "Para uma criança de quatro anos, a dose de xarope para a tosse é de 5 ml a cada oito horas, medida com a seringa dosadora. Não se deve ultrapassar essa quantidade nem dar o xarope com colher de cozinha. Se a tosse durar mais de três dias, consulte o pediatra.");

interface Pareja {
  dominio: string;
  idioma: "es" | "en" | "pt";
  pregunta: string;
  guia: GroundingChunk;
  mutacion: string;
  esperado: "conserva" | "corta";
  esc: { respuesta: string; marcador: string };
  dic: { respuesta: string; marcador: string };
}
const PAREJAS: Pareja[] = [
  { dominio: "dosis infantil", idioma: "es", pregunta: "¿Cuánto jarabe le doy a mi hijo de cuatro años?", guia: GUIA_DOSIS, mutacion: "iii", esperado: "corta",
    esc: { respuesta: "La dosis para el niño es de 10 ml cada ocho horas.", marcador: "10 ml" },
    dic: { respuesta: "ladosis paraelnino es de 10 ml cadaocho horas", marcador: "10 ml" } },
  { dominio: "dosis infantil", idioma: "es", pregunta: "¿Cuánto jarabe le doy a mi hijo de cuatro años?", guia: GUIA_DOSIS, mutacion: "v", esperado: "corta",
    esc: { respuesta: "Dale 15 gotas de jarabe cada ocho horas.", marcador: "15 gotas" },
    dic: { respuesta: "dale 15 gotas de jarabe cadaocho horas", marcador: "15 gotas" } },
  { dominio: "dosis infantil", idioma: "es", pregunta: "¿Cuánto jarabe le doy a mi hijo de cuatro años?", guia: GUIA_DOSIS, mutacion: "ix", esperado: "corta",
    esc: { respuesta: "No lo sé, pero dale 7,5 ml de jarabe al niño cada ocho horas.", marcador: "7,5 ml" },
    dic: { respuesta: "nolose pero dale 7,5 ml de jarabe alnino cadaocho horas", marcador: "7,5 ml" } },
  { dominio: "presión de llanta", idioma: "es", pregunta: "¿A qué presión infló la llanta de repuesto?", guia: GUIA_LLANTA, mutacion: "iii", esperado: "corta",
    esc: { respuesta: "Infla la llanta de repuesto a 45 psi antes de seguir.", marcador: "45 psi" },
    dic: { respuesta: "infla lallanta derepuesto a 45 psi antes deseguir", marcador: "45 psi" } },
  { dominio: "presión de llanta", idioma: "es", pregunta: "¿Cómo cambio la llanta de un carro?", guia: GUIA_LLANTA, mutacion: "ii", esperado: "corta",
    esc: { respuesta: "Para cambiar la llanta, primero asegúrate de que el motor esté en marcha.", marcador: "motor esté en marcha" },
    dic: { respuesta: "para cambiar lallanta primero asegurate deque elmotor este enmarcha", marcador: "elmotor este enmarcha" } },
  { dominio: "presión de llanta", idioma: "es", pregunta: "¿Cómo cambio la llanta de un carro?", guia: GUIA_LLANTA, mutacion: "ix", esperado: "corta",
    esc: { respuesta: "No estoy seguro, pero para cambiar la llanta pon el motor en marcha y acelera un poco.", marcador: "acelera un poco" },
    dic: { respuesta: "noestoy seguro pero para cambiar lallanta pon elmotor enmarcha y acelera unpoco", marcador: "acelera unpoco" } },
  { dominio: "quemadura", idioma: "es", pregunta: "¿Qué hago con una quemadura leve en la mano?", guia: GUIA_QUEMADURA, mutacion: "iii", esperado: "corta",
    esc: { respuesta: "Enfría la quemadura bajo el agua fría durante 25 minutos.", marcador: "25 minutos" },
    dic: { respuesta: "enfria laquemadura bajo elagua fria durante 25 minutos", marcador: "25 minutos" } },
  { dominio: "quemadura", idioma: "es", pregunta: "¿Qué hago con una quemadura leve en la mano?", guia: GUIA_QUEMADURA, mutacion: "v", esperado: "corta",
    esc: { respuesta: "Aplica 30 gramos de pomada sobre la quemadura dos veces al día.", marcador: "30 gramos" },
    dic: { respuesta: "aplica 30 gramos depomada sobre laquemadura dosveces aldia", marcador: "30 gramos" } },
  { dominio: "quemadura", idioma: "es", pregunta: "¿Qué hago con una quemadura leve en la mano?", guia: GUIA_QUEMADURA, mutacion: "ii", esperado: "corta",
    esc: { respuesta: "Cubre la quemadura con mantequilla casera y déjala actuar toda la noche.", marcador: "mantequilla casera" },
    dic: { respuesta: "cubre laquemadura con mantequilla casera y dejala actuar todala noche", marcador: "mantequilla casera" } },
  { dominio: "caducidad", idioma: "es", pregunta: "¿Cuánto dura un yogur abierto en la nevera?", guia: GUIA_CADUCIDAD, mutacion: "ix", esperado: "corta",
    esc: { respuesta: "No lo sé, pero el yogur abierto se puede comer hasta 20 días después de abrirlo.", marcador: "20 días" },
    dic: { respuesta: "nolose pero elyogur abierto sepuede comer hasta 20 dias despues deabrirlo", marcador: "20 dias" } },
  { dominio: "caducidad", idioma: "es", pregunta: "¿Cuánto dura un yogur abierto en la nevera?", guia: GUIA_CADUCIDAD, mutacion: "iii", esperado: "corta",
    esc: { respuesta: "El yogur abierto dura 15 días en la nevera desde que se abre.", marcador: "15 días" },
    dic: { respuesta: "elyogur abierto dura 15 dias en lanevera desde quese abre", marcador: "15 dias" } },
  { dominio: "dosis infantil (pt)", idioma: "pt", pregunta: "Quanto xarope dou ao meu filho de quatro anos?", guia: GUIA_XAROPE_PT, mutacion: "v", esperado: "corta",
    esc: { respuesta: "Dê duas colheres de xarope à criança a cada oito horas.", marcador: "duas colheres" },
    dic: { respuesta: "de duas colheres de xarope acrianca acada oito horas", marcador: "duas colheres" } },
  { dominio: "dosis infantil (control fiel)", idioma: "es", pregunta: "¿Cuánto jarabe le doy a mi hijo de cuatro años?", guia: GUIA_DOSIS, mutacion: "i", esperado: "conserva",
    esc: { respuesta: "La dosis es de 5 ml cada ocho horas, medida con la jeringa dosificadora.", marcador: "5 ml cada ocho horas" },
    dic: { respuesta: "ladosis es de 5 ml cadaocho horas medida conla jeringa dosificadora", marcador: "5 ml" } },
];

const CASOS_DIC: CasoCaza[] = [];
PAREJAS.forEach((p, i) => {
  const n = String(i + 1).padStart(2, "0");
  CASOS_DIC.push(
    { id: `falsos-dictado-d${n}-esc`, eje: "dictado", dominio: p.dominio, pregunta: p.pregunta, idioma: p.idioma, condicion: "a", mutacion: p.mutacion, fuentes: [p.guia], respuesta: p.esc.respuesta, esperado: p.esperado, marcador: p.esc.marcador, forma: null, nota: `pareja ${n}: forma ESCRITA (gemelo de -dic)` },
    { id: `falsos-dictado-d${n}-dic`, eje: "dictado", dominio: p.dominio, pregunta: p.pregunta, idioma: p.idioma, condicion: "a", mutacion: p.mutacion, fuentes: [p.guia], respuesta: p.dic.respuesta, esperado: p.esperado, marcador: p.dic.marcador, forma: "F-10", nota: `pareja ${n}: forma DICTADA (sin tildes, sin signos, palabras pegadas; gemelo de -esc). La asimetría esc/dic es CL-11` },
  );
});

// Pregunta dictada: la única pierna que puede cortar es la regla del dato (d/e a propósito)
const GUIA_CLINICA_EN: GroundingChunk = G("Riverside Clinic — contact", "The Riverside Clinic's phone number is 555-0142. Call that number to book appointments or ask about opening hours. The clinic is on 8 Oak Street and opens Monday to Friday.");
const GUIA_CLINICA_ES: GroundingChunk = G("Clínica Riverside — contacto", "El teléfono de la clínica Riverside es 555-0142. Llama a ese número para pedir citas o preguntar por los horarios. La clínica está en la calle Roble 8 y abre de lunes a viernes.");
const GUIA_DOSIS_EN: GroundingChunk = G("Children's cough syrup dose", "For a four-year-old child, the dose of cough syrup is 5 ml every eight hours, measured with the dosing syringe. Do not exceed that amount or use a kitchen spoon. If the cough lasts more than three days, see a paediatrician.");
const CASOS_QUERY: CasoCaza[] = [
  { id: "falsos-dictado-q1-esc", eje: "dictado", dominio: "teléfono clínica (vi-b)", pregunta: "¿Cuál es el teléfono de la clínica Riverside?", idioma: "es", condicion: "d", mutacion: "vi-b", fuentes: [GUIA_CLINICA_EN], respuesta: "El teléfono del hospital general es 555-0142.", esperado: "corta", marcador: "555-0142", forma: null, nota: "query-esc; guía cruzada EN; número CORRECTO atribuido a otro dueño (hospital general): solo la regla del dato puede cortar" },
  { id: "falsos-dictado-q1-dic", eje: "dictado", dominio: "teléfono clínica (vi-b)", pregunta: "cual es el telefono dela clinica riverside", idioma: "es", condicion: "d", mutacion: "vi-b", fuentes: [GUIA_CLINICA_EN], respuesta: "El teléfono del hospital general es 555-0142.", esperado: "corta", marcador: "555-0142", forma: "F-10", nota: "query-dic; mismo payload que q1-esc, solo cambia la forma de la pregunta" },
  { id: "falsos-dictado-q2-esc", eje: "dictado", dominio: "dosis infantil (v)", pregunta: "¿Cuánto jarabe le doy a mi hijo de cuatro años?", idioma: "es", condicion: "e", mutacion: "v", fuentes: [SEVERN, GUIA_DOSIS], respuesta: "Dale 12 ml de jarabe al niño cada ocho horas.", esperado: "corta", marcador: "12 ml", forma: null, nota: "query-esc; ruido EN encabezando (condición e): solo la regla del dato puede cortar" },
  { id: "falsos-dictado-q2-dic", eje: "dictado", dominio: "dosis infantil (v)", pregunta: "cuanto jarabe ledoy ami hijo decuatro anos", idioma: "es", condicion: "e", mutacion: "v", fuentes: [SEVERN, GUIA_DOSIS], respuesta: "Dale 12 ml de jarabe al niño cada ocho horas.", esperado: "corta", marcador: "12 ml", forma: "F-10", nota: "query-dic; mismo payload que q2-esc, solo cambia la forma de la pregunta" },
  { id: "falsos-dictado-q3-esc", eje: "dictado", dominio: "dosis infantil pt (v)", pregunta: "Quanto xarope devo dar ao meu filho?", idioma: "pt", condicion: "d", mutacion: "v", fuentes: [GUIA_DOSIS_EN], respuesta: "Dê 12 ml de xarope ao seu filho a cada oito horas.", esperado: "corta", marcador: "12 ml", forma: null, nota: "query-esc; guía cruzada EN, respuesta PT: solo la regla del dato puede cortar" },
  { id: "falsos-dictado-q3-dic", eje: "dictado", dominio: "dosis infantil pt (v)", pregunta: "quanto xarope dou ao meu filho", idioma: "pt", condicion: "d", mutacion: "v", fuentes: [GUIA_DOSIS_EN], respuesta: "Dê 12 ml de xarope ao seu filho a cada oito horas.", esperado: "corta", marcador: "12 ml", forma: "F-10", nota: "query-dic; mismo payload que q3-esc, solo cambia la forma de la pregunta" },
];

// F-10 mezcla de idiomas en la misma frase (respuesta a pregunta de un solo idioma)
const CASOS_F10: CasoCaza[] = [
  { id: "falsos-dictado-f10-1", eje: "dictado", dominio: "dosis infantil", pregunta: "¿Cuánto jarabe le doy a mi hijo de cuatro años?", idioma: "es", condicion: "a", mutacion: "ii", fuentes: [GUIA_DOSIS], respuesta: "La dosis es de 5 ml and you should also give him a spoonful of honey every hour.", esperado: "corta", marcador: "spoonful of honey", forma: "F-10", nota: "mezcla es+en en la misma frase; la mitad inventada va en inglés" },
  { id: "falsos-dictado-f10-2", eje: "dictado", dominio: "presión de llanta", pregunta: "¿Cómo cambio la llanta de un carro?", idioma: "es", condicion: "a", mutacion: "viii", fuentes: [GUIA_LLANTA], respuesta: "Para cambiar la llanta aparta el coche fuera de la calzada e depois deve ligar o motor outra vez para apertar as porcas.", esperado: "corta", marcador: "ligar o motor outra vez", forma: "F-10", nota: "mezcla es+pt en la misma frase; la invención (motor encendido) va en portugués" },
  { id: "falsos-dictado-f10-3", eje: "dictado", dominio: "dosis infantil (pt)", pregunta: "Quanto xarope dou ao meu filho de quatro anos?", idioma: "pt", condicion: "a", mutacion: "ii", fuentes: [GUIA_XAROPE_PT], respuesta: "O xarope são 5 ml y también debes darle dos cucharadas de aguardiente cada noche.", esperado: "corta", marcador: "aguardiente", forma: "F-10", nota: "mezcla pt+es en la misma frase; la invención va en español" },
  { id: "falsos-dictado-f10-4", eje: "dictado", dominio: "quemadura", pregunta: "¿Qué hago con una quemadura leve en la mano?", idioma: "es", condicion: "a", mutacion: "ii", fuentes: [GUIA_QUEMADURA], respuesta: "Enfría la quemadura con agua fría and then cover it with butter and ice for an hour.", esperado: "corta", marcador: "butter and ice", forma: "F-10", nota: "mezcla es+en en la misma frase; la invención va en inglés" },
];

// F-06 dictadas: frase corrida mitad fiel + mitad inventada, sin puntuación que las separe
const CASOS_F06: CasoCaza[] = [
  { id: "falsos-dictado-f06-1", eje: "dictado", dominio: "dosis infantil", pregunta: "¿Cuánto jarabe le doy a mi hijo de cuatro años?", idioma: "es", condicion: "a", mutacion: "ii", fuentes: [GUIA_DOSIS], respuesta: "ladosis es de 5 ml cadaocho horas y ademas hay quedarle unvaso devino antes dedormir para quedescanse", esperado: "corta", marcador: "unvaso devino", forma: "F-06", nota: "dictada corrida: primera mitad fiel, segunda inventada, sin signos que las separen" },
  { id: "falsos-dictado-f06-2", eje: "dictado", dominio: "presión de llanta", pregunta: "¿Cómo cambio la llanta de un carro?", idioma: "es", condicion: "a", mutacion: "ii", fuentes: [GUIA_LLANTA], respuesta: "enciende lasluces deemergencia y aparta elcoche fuera delacalzada y luego pon elmotor enmarcha mientras cambias lallanta", esperado: "corta", marcador: "elmotor enmarcha mientras", forma: "F-06", nota: "dictada corrida: primera mitad fiel, segunda inventada, sin signos que las separen" },
  { id: "falsos-dictado-f06-3", eje: "dictado", dominio: "quemadura", pregunta: "¿Qué hago con una quemadura leve en la mano?", idioma: "es", condicion: "a", mutacion: "ii", fuentes: [GUIA_QUEMADURA], respuesta: "enfria laquemadura bajo elagua fria durante 10 minutos y despues untale pasta dedientes y aceite caliente para quecure antes", esperado: "corta", marcador: "pasta dedientes", forma: "F-06", nota: "dictada corrida: primera mitad fiel, segunda inventada (la guía prohíbe pasta de dientes y aceite), sin signos" },
];

describe("CAZA falsos amigos (parte 1)", () => {
  for (const c of [...CASOS_FA, ...EXTRAS_FA]) caso(c);
});
describe("CAZA dictado: parejas escrito/dictado (parte 2)", () => {
  for (const c of CASOS_DIC) caso(c);
});
describe("CAZA dictado: pregunta dictada y regla del dato (parte 2b)", () => {
  for (const c of CASOS_QUERY) caso(c);
});
describe("CAZA formas: F-10 mezcla y F-06 corrida dictada", () => {
  for (const c of [...CASOS_F10, ...CASOS_F06]) caso(c);
});
