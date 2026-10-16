/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * routerSweep.pure.ts — 0.1.42: la prueba física de la Tab A9+ (14-oct), a
 * escala. Genera miles de frases de las mismas familias que el dueño probó
 * a mano (recordar datos, recordatorios, notas, preguntas sobre uno mismo,
 * cuentas, conversiones, fechas) con las variantes que aparecen de verdad
 * al escribir en un teléfono (sin acentos, mayúsculas, «por cierto» delante,
 * entre «¿?», espacios dobles, punto final) y las pasa por la MISMA cadena
 * determinista que el chat, en el mismo orden (ChatScreen → runAgentLoop).
 *
 * Cada frase sale por uno de tres sitios:
 *   - «router:<vía>»: la resuelve el código (lo que se quiere para órdenes);
 *   - «model»: entra al asistente pero ninguna vía la reconoce y cae al
 *     modelo pequeño (lo que hoy falló en la tablet);
 *   - «chat»: NIDO la toma por conversación y ni siquiera intenta la orden
 *     (el fallo invisible).
 *
 * No ejecuta el modelo (no hay modelo aquí): mide el ROUTER, que es donde
 * estuvieron casi todos los fallos de la prueba física.
 */
import { classifyIntent } from "../agent/loop/intent";
import { normalizeForRouting } from "../agent/loop/routingText";
import { matchCanned } from "../agent/loop/cannedResponses";
import {
  extractCalcAction,
  extractReminderAction,
  extractTimerAction,
  extractWeeklyPlanAction,
} from "../agent/loop/actionRouter";
import { extractContactAction } from "../agent/loop/contactRouter";
import { extractToolAction, TOOL_KINDS } from "../agent/loop/toolRouter";
import {
  extractImplicitFact,
  extractPeople,
  extractRememberFact,
  extractSelfName,
} from "../agent/loop/rememberRouter";
import {
  answerMemoryQuery,
  isGenericMemoryQuestionShape,
  memoryFullCoverageHit,
  memoryGateHit,
  type MemoryQueryData,
} from "../agent/loop/memoryQuery";

export type Family =
  | "remember"
  | "selfFact"
  | "reminder"
  | "timer"
  | "note"
  | "memoryQuestion"
  | "calc"
  | "convert"
  | "date"
  | "chat"
  // 0.1.43 (paso 2): las familias que bajan la deuda de PENDING_ROUTES.
  | "contact"
  | "reminderManage"
  | "calendar"
  | "noteDelete"
  | "weeklyPlan";

export interface SweepCase {
  text: string;
  family: Family;
  lang: "es" | "en" | "pt";
  /** Plantilla de la que sale (para agrupar los fallos). */
  template: string;
  /** Variante aplicada («base», «sinAcentos», «porCierto»…). */
  variant: string;
}

/** Vías del router que cuentan como acierto para cada familia. */
export const EXPECTED: Record<Family, readonly string[]> = {
  remember: ["remember_fact", "save_person", "self_name", "create_reminder"],
  selfFact: ["remember_fact", "save_person", "self_name"],
  reminder: ["create_reminder", "timer"],
  timer: ["timer", "create_reminder"],
  note: ["noteSave", "noteList", "noteRead", "noteSearch"],
  memoryQuestion: ["memory_query"],
  calc: ["calc"],
  convert: ["convert"],
  date: ["time", "weekday", "countdown"],
  // Conversación: lo correcto es NO actuar (chat o modelo).
  chat: ["chat", "model", "canned"],
  // 0.1.43 (paso 2): «contact» cubre llamar y SMS (contactRouter); la
  // mensajería sin canal («mándale un mensaje a X») es un caso ambiguo
  // deliberado y se vigila aparte: vale contact o nidoSend.
  contact: ["contact"],
  reminderManage: ["reminderList", "reminderDelete"],
  calendar: ["calendarCreate", "calendarList"],
  noteDelete: ["noteDelete"],
  weeklyPlan: ["weekly_plan"],
};

/**
 * 0.1.43: TODAS las rutas que routeOf() puede devolver — las fijas de
 * esta función más cada «kind» de extractToolAction (TOOL_KINDS). Es el
 * inventario completo del router: si una ruta nueva aparece en el
 * código, aparece aquí sola, y el test de cobertura la exige en una
 * familia del barrido o en la deuda declarada de abajo.
 */
export const ROUTER_ROUTES: readonly string[] = [
  "canned",
  "calc",
  "contact",
  "timer",
  "create_reminder",
  "weekly_plan",
  "save_person",
  "self_name",
  "remember_fact",
  "memory_query",
  "model",
  "chat",
  ...TOOL_KINDS,
];

/**
 * Deuda declarada (0.1.43): rutas reales del router que el barrido
 * todavía no ejercita con ninguna familia. Nombrarlas aquí es lo que
 * permite que el test de cobertura distinga «sin probar a propósito»
 * de «sin probar por olvido». El Paso 2 de la v0.1.43 las va sacando
 * de esta lista familia a familia; las que queden se miden en la
 * v0.1.44.
 */
export const PENDING_ROUTES: readonly string[] = [
  "currencyInfo",
  "memoryForgetHelp",
  "nidoCode",
  "nidoInbox",
  "nidoSend",
  "nidoTasks",
  "openLink",
  "pickFile",
  "reminderFill",
  "reminderOfferCreate",
];

// ------------------------------------------------------------ plantillas

const FACTS_ES = [
  "mi perro se llama Toby",
  "la clave del wifi está en la nevera",
  "mi hermana vive en Lima",
  "el dentista me atiende los jueves",
  "mi talla de zapato es 42",
  "dejé el coche en el nivel 3 del estacionamiento",
  "mi jefe se llama Ramiro",
  "el seguro del coche vence en marzo",
];
const FACTS_EN = [
  "my dog's name is Toby",
  "the wifi password is on the fridge",
  "my sister lives in Lima",
  "I parked on level 3",
  "my boss is called Ramiro",
];
const FACTS_PT = ["meu cachorro se chama Toby", "a senha do wifi está na geladeira", "minha irmã mora em Lima", "estacionei no nível 3"];

const REMEMBER_ES = [
  "recuerda que {F}",
  "acuérdate de que {F}",
  "no olvides que {F}",
  "que no se te olvide que {F}",
  "ten en cuenta que {F}",
  "guarda que {F}",
  "memoriza que {F}",
  "guarda en tu memoria que {F}",
  "toma en cuenta que {F}",
  "quiero que recuerdes que {F}",
  "para que lo sepas, {F}",
  "anota en tu memoria que {F}",
  "no te olvides de que {F}",
];
const REMEMBER_EN = [
  "remember that {F}",
  "don't forget that {F}",
  "keep in mind that {F}",
  "please remember {F}",
  "just so you know, {F}",
  "make sure you remember that {F}",
];
const REMEMBER_PT = ["lembre que {F}", "não esqueça que {F}", "tenha em mente que {F}", "lembre-se de que {F}", "guarda que {F}"];

const SELF_ES = [
  "soy vegetariano",
  "soy alérgica a las nueces",
  "tengo alergia al polen",
  "vivo en Phoenix",
  "trabajo de noche",
  "me llamo Aldo",
  "mi color favorito es el azul",
  "mi cumpleaños es el 3 de mayo",
  "mi coche es un Mazda",
  "mi mamá se llama Marta",
  "tengo dos hijos",
  "estoy casado",
  "no como cerdo",
  "soy diabético",
  "a partir de ahora háblame de usted",
];
const SELF_EN = ["I'm vegetarian", "I live in Phoenix", "my name is Aldo", "my favorite color is blue", "my birthday is May 3", "I'm allergic to peanuts", "I have two kids"];
const SELF_PT = ["sou vegetariano", "moro em Phoenix", "meu nome é Aldo", "minha cor favorita é azul", "meu aniversário é 3 de maio", "tenho alergia a camarão"];

const TASKS_ES = ["llamar a mi tía", "comprar pan", "pagar la renta", "sacar la ropa", "tomar la pastilla"];
const TIMES_ES = ["mañana a las 8", "el viernes a las 6", "en 20 minutos", "en media hora", "pasado mañana", "hoy a las 5 de la tarde", "el 3 de noviembre"];
const REMIND_ES = [
  "recuérdame {T} {X}",
  "{T} recuérdame {X}",
  "avísame {T} que tengo que {X}",
  "pon un recordatorio {T} para {X}",
  "{T} me recuerdas {X}",
  "me puedes recordar {T} {X}",
  "no me dejes olvidar {X} {T}",
  "recuérdame {X} {T}",
  "crea un recordatorio para {X} {T}",
  "¿me recuerdas {X} {T}?",
];
const TASKS_EN = ["call mom", "buy bread", "pay the rent"];
const TIMES_EN = ["tomorrow at 8", "on friday at 6", "in 20 minutes", "in half an hour"];
const REMIND_EN = ["remind me {T} to {X}", "remind me to {X} {T}", "set a reminder {T} to {X}", "{T} remind me to {X}", "can you remind me to {X} {T}"];
const TASKS_PT = ["ligar para minha tia", "pagar a conta", "comprar pão"];
const TIMES_PT = ["amanhã às 8", "na sexta às 6", "em 20 minutos"];
const REMIND_PT = ["me lembra {T} de {X}", "me lembre de {X} {T}", "lembra-me {T} de {X}", "cria um lembrete {T} para {X}"];

const TIMER = [
  ["es", "pon un temporizador de 10 minutos"],
  ["es", "temporizador de 5 minutos"],
  ["es", "ponme una alarma en 15 minutos"],
  ["es", "cuenta 3 minutos"],
  ["es", "avísame en 10 minutos"],
  ["en", "set a timer for 10 minutes"],
  ["en", "timer 5 minutes"],
  ["en", "start a 3 minute timer"],
  ["pt", "coloca um timer de 10 minutos"],
  ["pt", "me avisa em 5 minutos"],
] as const;

const NOTE = [
  ["es", "anota que mañana hay junta"],
  ["es", "apunta: leche, huevos y pan"],
  ["es", "toma nota de que el código es 4512"],
  ["es", "crea una nota que diga comprar foco"],
  ["es", "apúntame la lista: leche, huevos y pan"],
  ["es", "guarda una nota: ideas para el viaje"],
  ["es", "qué notas tengo"],
  ["es", "muéstrame mis notas"],
  ["es", "lee la nota del viaje"],
  ["en", "take a note: buy milk"],
  ["en", "make a note that the code is 4512"],
  ["en", "what notes do I have"],
  ["en", "show my notes"],
  ["pt", "anote que amanhã tem reunião"],
  ["pt", "quais notas eu tenho"],
] as const;

const MEMQ = [
  ["es", "¿cuándo es mi cumpleaños?"],
  ["es", "qué sabes de mí"],
  ["es", "¿cómo se llama mi perro?"],
  ["es", "¿dónde vivo?"],
  ["es", "¿cuál es mi color favorito?"],
  ["es", "¿cómo me llamo?"],
  ["es", "¿qué recuerdas de mí?"],
  ["es", "¿cómo se llama mi mamá?"],
  ["es", "¿dónde dejé el coche?"],
  ["es", "¿dónde está la clave del wifi?"],
  ["en", "when is my birthday?"],
  ["en", "what do you know about me?"],
  ["en", "what's my dog's name?"],
  ["en", "where do I live?"],
  ["pt", "quando é meu aniversário?"],
  ["pt", "o que você sabe sobre mim?"],
] as const;

const CALC = [
  ["es", "cuánto es 15 por 4"],
  ["es", "cuánto es el 15% de 80"],
  ["es", "15 x 4"],
  ["es", "cuánto es 1200 entre 3"],
  ["es", "raíz cuadrada de 81"],
  ["es", "cuánto es 2 más 2"],
  ["es", "calcula 18% de 250"],
  ["es", "cuánto es 7 al cuadrado"],
  ["en", "what is 15 times 4"],
  ["en", "15% of 80"],
  ["en", "square root of 81"],
  ["pt", "quanto é 15 vezes 4"],
  ["pt", "quanto é 20% de 150"],
] as const;

const CONVERT = [
  ["es", "cuántos grados fahrenheit son 30 grados"],
  ["es", "pasa 30 grados a fahrenheit"],
  ["es", "convierte 5 libras a kilos"],
  ["es", "cuántos kilómetros son 10 millas"],
  ["es", "cuántas millas son 10 km"],
  ["es", "70 kg en libras"],
  ["es", "cuántos centímetros son 6 pulgadas"],
  ["es", "convierte 100 fahrenheit a celsius"],
  ["en", "convert 5 pounds to kg"],
  ["en", "how many miles is 10 km"],
  ["en", "30 celsius to fahrenheit"],
  ["pt", "quantos quilômetros são 10 milhas"],
  ["pt", "converte 5 libras para kg"],
] as const;

const DATE = [
  ["es", "qué hora es"],
  ["es", "qué día es hoy"],
  ["es", "qué día cae el 25 de diciembre"],
  ["es", "cuántos días faltan para navidad"],
  ["es", "qué día de la semana es el 1 de enero"],
  ["es", "a qué fecha estamos"],
  ["es", "en qué día cae mi cumpleaños"],
  ["en", "what time is it"],
  ["en", "what day is December 25"],
  ["en", "how many days until christmas"],
  ["pt", "que horas são"],
  ["pt", "que dia cai 25 de dezembro"],
] as const;

const CHAT = [
  ["es", "¿qué es la inflación?"],
  ["es", "cuéntame un chiste"],
  ["es", "explícame la fotosíntesis"],
  ["es", "¿quién fue Napoleón?"],
  ["es", "¿cómo se dice perro en inglés?"],
  ["es", "no me acuerdo de su nombre"],
  ["es", "me recuerdas a mi padre"],
  ["es", "¿recuerdas la película Titanic?"],
  ["es", "la reunión fue el viernes"],
  ["es", "mi abuela decía que la paciencia es oro"],
  ["es", "¿qué opinas de los gatos?"],
  ["es", "escríbeme un poema sobre el mar"],
  ["es", "resume la historia de Roma"],
  ["es", "¿cuál es la capital de Perú?"],
  ["en", "what is inflation?"],
  ["en", "tell me a joke"],
  ["en", "I can't remember his name"],
  ["en", "who was Napoleon?"],
  ["pt", "o que é inflação?"],
  ["pt", "me conta uma piada"],
] as const;

// 0.1.43 (paso 2): familias nuevas. Frases reales contra las reglas que
// ya existen (contactRouter, REMINDER_LIST/CAL_*/DELETE de toolRouter,
// extractWeeklyPlanAction): el barrido mide, no maquilla — lo que las
// variantes rompan se verá en la tasa de la familia.

const CONTACT = [
  ["es", "llama a mi mamá"],
  ["es", "llámale a Ana"],
  ["es", "marca al 555 1234"],
  ["es", "haz una llamada a Juan"],
  ["es", "mándale un sms a Ana que llego tarde"],
  ["es", "envía un mensaje de texto a Juan: ya salí"],
  ["es", "escríbele un sms a mi hermana"],
  ["en", "call mom"],
  ["en", "call Ana"],
  ["en", "dial 555 1234"],
  ["en", "text Ana that I'm late"],
  ["en", "send a text to Juan saying hi"],
  ["en", "sms mom"],
  ["pt", "liga para a Ana"],
  ["pt", "ligue pro João"],
  ["pt", "telefona para a minha mãe"],
  ["pt", "manda um sms para a Ana dizendo que chego tarde"],
  ["pt", "manda um torpedo para o João"],
  ["pt", "envia uma mensagem de texto para a Ana"],
] as const;

const REMINDER_MANAGE = [
  ["es", "qué recordatorios tengo"],
  ["es", "muéstrame mis recordatorios"],
  ["es", "qué recordatorios tengo hoy"],
  ["es", "tengo algún recordatorio"],
  ["es", "borra el recordatorio de la renta"],
  ["es", "cancela el recordatorio de mañana"],
  ["es", "borra todos mis recordatorios"],
  ["es", "borra el recordatorio"],
  ["en", "show my reminders"],
  ["en", "what reminders do i have"],
  ["en", "do i have any reminders"],
  ["en", "delete the dentist reminder"],
  ["en", "delete my reminder to call mom"],
  ["en", "cancel my reminder"],
  ["en", "delete all my reminders"],
  ["pt", "mostra meus lembretes"],
  ["pt", "que lembretes eu tenho"],
  ["pt", "tenho algum lembrete"],
  ["pt", "apaga o lembrete do dentista"],
  ["pt", "cancela o lembrete"],
  ["pt", "apaga todos os meus lembretes"],
] as const;

const CALENDAR = [
  ["es", "agenda una reunión el viernes a las 10"],
  ["es", "agrega una cita con el dentista mañana a las 9"],
  ["es", "crea un evento: cena el sábado a las 8"],
  ["es", "pon en mi calendario la junta del lunes"],
  ["es", "qué tengo en mi agenda hoy"],
  ["es", "mi agenda de mañana"],
  ["es", "mis eventos de esta semana"],
  ["es", "mi calendario"],
  ["en", "schedule a meeting on monday at 9"],
  ["en", "add a meeting on friday at 10"],
  ["en", "create an event: dentist tomorrow at 9"],
  ["en", "add an appointment to my calendar: lunch friday"],
  ["en", "what do i have tomorrow"],
  ["en", "what's on my calendar today"],
  ["en", "my calendar"],
  ["en", "my agenda for this week"],
  ["pt", "marca uma reunião segunda às 9"],
  ["pt", "agenda uma consulta amanhã às 10"],
  ["pt", "adiciona um evento: almoço sábado"],
  ["pt", "cria um evento amanhã"],
  ["pt", "o que eu tenho amanhã"],
  ["pt", "minha agenda de hoje"],
  ["pt", "meus compromissos desta semana"],
  ["pt", "minha agenda"],
] as const;

const NOTE_DELETE = [
  ["es", "borra la nota de la receta"],
  ["es", "elimina mi nota del viaje"],
  ["es", "quita la nota de la lista de compras"],
  ["es", "borra todas mis notas"],
  ["es", "borra la nota"],
  ["en", "delete the shopping note"],
  ["en", "delete my note about the trip"],
  ["en", "delete all my notes"],
  ["en", "delete the note"],
  ["pt", "apaga a nota da receita"],
  ["pt", "exclui a nota do mercado"],
  ["pt", "apaga todas as minhas notas"],
  ["pt", "apaga a nota"],
] as const;

const WEEKLY_PLAN = [
  ["es", "planifica mi semana"],
  ["es", "organiza mi semana"],
  ["es", "hazme un plan semanal"],
  ["es", "quiero un plan para mi semana"],
  ["es", "planifica mi semana, trabajo de 9 a 6"],
  ["es", "plan semanal"],
  ["en", "plan my week"],
  ["en", "make me a weekly plan"],
  ["en", "i need a plan for my week"],
  ["en", "create a weekly plan"],
  ["en", "weekly plan"],
  ["pt", "faz um plano semanal"],
  ["pt", "planeja minha semana"],
  ["pt", "organiza minha semana"],
  ["pt", "quero um plano da minha semana"],
  ["pt", "plano semanal"],
] as const;

/**
 * 0.1.43 (paso 2): las «casi órdenes» de cada familia nueva — frases
 * que parecen una orden pero no lo son. Lo correcto es que se queden
 * en charla (chat/model/canned), SIEMPRE: el mínimo es el 100 %. Si
 * una dispara una acción es el fallo grave de la v0.1.44, no un
 * porcentaje que se diluye en la media de una familia.
 */
export const NEAR_MISS: Record<"contact" | "reminderManage" | "calendar" | "noteDelete" | "weeklyPlan", ReadonlyArray<readonly [string, string]>> = {
  contact: [
    ["es", "ayer me llamó mi mamá"],
    ["es", "mi hermana nunca contesta mensajes"],
    ["es", "perdí el número de Juan"],
    ["es", "mi teléfono no tiene señal"],
    ["es", "las llamadas de ventas me tienen harto"],
    ["es", "mi mamá me escribe todos los días"],
    ["es", "no sé dónde guardé ese contacto"],
    ["es", "el teléfono de mi casa ya no funciona"],
    ["en", "my mom called me yesterday"],
    ["en", "my sister never answers her messages"],
    ["en", "i lost Juan's number"],
    ["en", "my phone has no signal"],
    ["en", "sales calls are so annoying"],
    ["en", "my mom texts me every day"],
    ["en", "i don't know where i saved that contact"],
    ["en", "our home phone doesn't work anymore"],
    ["pt", "minha mãe me ligou ontem"],
    ["pt", "minha irmã nunca responde mensagens"],
    ["pt", "perdi o número do João"],
    ["pt", "meu celular está sem sinal"],
    ["pt", "ligações de vendas são um saco"],
    ["pt", "minha mãe me escreve todo dia"],
    ["pt", "não sei onde salvei esse contato"],
    ["pt", "o telefone de casa não funciona mais"],
  ],
  reminderManage: [
    ["es", "nunca me acuerdo de nada"],
    ["es", "mis recordatorios del móvil viejo eran mejores"],
    ["es", "se me olvidó el recordatorio de ayer"],
    ["es", "los recordatorios me estresan"],
    ["es", "ayer borré un recordatorio sin querer"],
    ["es", "mi memoria ya no es la de antes"],
    ["es", "qué mala memoria tengo"],
    ["es", "antes no necesitaba recordatorios"],
    ["en", "i never remember anything"],
    ["en", "my old phone's reminders were better"],
    ["en", "i forgot yesterday's reminder"],
    ["en", "reminders stress me out"],
    ["en", "i deleted a reminder by accident yesterday"],
    ["en", "my memory isn't what it used to be"],
    ["en", "i have such a bad memory"],
    ["en", "i didn't use to need reminders"],
    ["pt", "nunca me lembro de nada"],
    ["pt", "meus lembretes do celular velho eram melhores"],
    ["pt", "esqueci o lembrete de ontem"],
    ["pt", "os lembretes me estressam"],
    ["pt", "ontem apaguei um lembrete sem querer"],
    ["pt", "minha memória já não é a mesma"],
    ["pt", "que memória ruim a minha"],
    ["pt", "antes eu não precisava de lembretes"],
  ],
  calendar: [
    ["es", "el calendario de este año está raro"],
    ["es", "¿cuándo fue la última vez que fui al dentista?"],
    ["es", "mi agenda está llena esta semana"],
    ["es", "odio las reuniones de los lunes"],
    ["es", "el calendario dice que hoy es festivo"],
    ["es", "tengo la semana complicadísima"],
    ["es", "las citas médicas me ponen nervioso"],
    ["es", "este mes se me hizo eterno"],
    ["en", "this year's calendar looks weird"],
    ["en", "when was the last time i went to the dentist?"],
    ["en", "my schedule is packed this week"],
    ["en", "i hate monday meetings"],
    ["en", "the calendar says today is a holiday"],
    ["en", "my week is completely crazy"],
    ["en", "doctor appointments make me nervous"],
    ["en", "this month felt endless"],
    ["pt", "o calendário deste ano está estranho"],
    ["pt", "quando foi a última vez que fui ao dentista?"],
    ["pt", "minha agenda está cheia esta semana"],
    ["pt", "odeio reuniões de segunda"],
    ["pt", "o calendário diz que hoje é feriado"],
    ["pt", "minha semana está complicadíssima"],
    ["pt", "consultas médicas me deixam nervoso"],
    ["pt", "este mês demorou uma eternidade"],
  ],
  noteDelete: [
    ["es", "borré sin querer una foto"],
    ["es", "quiero olvidarme de ese día"],
    ["es", "mis notas de la escuela eran un desastre"],
    ["es", "perdí la nota que me dejó mi mamá"],
    ["es", "las notas adhesivas se caen siempre"],
    ["es", "escribí una nota y la perdí"],
    ["es", "mi cuaderno de notas está lleno"],
    ["es", "no encuentro la receta que anoté"],
    ["en", "i deleted a photo by accident"],
    ["en", "i want to forget that day"],
    ["en", "my school notes were a mess"],
    ["en", "i lost the note my mom left me"],
    ["en", "sticky notes always fall off"],
    ["en", "i wrote a note and lost it"],
    ["en", "my notebook is full"],
    ["en", "i can't find the recipe i wrote down"],
    ["pt", "apaguei uma foto sem querer"],
    ["pt", "quero esquecer aquele dia"],
    ["pt", "minhas anotações da escola eram uma bagunça"],
    ["pt", "perdi o bilhete que minha mãe deixou"],
    ["pt", "os post-its sempre caem"],
    ["pt", "escrevi uma nota e perdi"],
    ["pt", "meu caderno está cheio"],
    ["pt", "não acho a receita que anotei"],
  ],
  weeklyPlan: [
    ["es", "esta semana fue larguísima"],
    ["es", "mi plan era descansar"],
    ["es", "la semana pasada viajé mucho"],
    ["es", "qué semana tan pesada"],
    ["es", "mi horario de trabajo es horrible"],
    ["es", "los planes nunca salen como uno quiere"],
    ["es", "esta semana no paró de llover"],
    ["es", "ya quiero que sea fin de semana"],
    ["en", "this week felt endless"],
    ["en", "my plan was to rest"],
    ["en", "last week i traveled a lot"],
    ["en", "what a heavy week"],
    ["en", "my work schedule is awful"],
    ["en", "plans never work out the way you want"],
    ["en", "it rained all week"],
    ["en", "i can't wait for the weekend"],
    ["pt", "esta semana foi longa demais"],
    ["pt", "meu plano era descansar"],
    ["pt", "semana passada viajei muito"],
    ["pt", "que semana pesada"],
    ["pt", "meu horário de trabalho é horrível"],
    ["pt", "os planos nunca saem como a gente quer"],
    ["pt", "choveu a semana toda"],
    ["pt", "quero que chegue o fim de semana"],
  ],
};

/**
 * 0.1.43 (paso 2): el caso ambiguo deliberado — «mándale un mensaje
 * a X» sin decir el canal. Las dos salidas son legítimas: SMS del
 * teléfono (contact) o mensaje NIDO (nidoSend), que además confirma
 * antes de enviar. Otra ruta sí sería un fallo.
 */
export const AMBIGUOUS_MESSAGE: ReadonlyArray<readonly [string, string]> = [
  ["es", "mándale un mensaje a Ana"],
  ["es", "envíale un mensaje a Juan que ya llegué"],
  ["es", "escríbele un mensaje a mi hermana"],
  ["en", "send a message to Ana"],
  ["en", "send Ana a message"],
  ["en", "message Ana that i'm late"],
  ["pt", "manda uma mensagem para a Ana"],
  ["pt", "envia uma mensagem pro João que já cheguei"],
];

// ------------------------------------------------------------- variantes

const noAccents = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[¿¡]/g, "");
const capFirst = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

const LEADS: Record<"es" | "en" | "pt", string[]> = {
  es: ["oye, ", "por cierto, ", "porfa ", "Por cierto,"],
  en: ["hey, ", "btw ", "please "],
  pt: ["ei, ", "por favor, "],
};

/** Las variantes de escritura de una frase (incluida la base). */
export function variantsOf(text: string, lang: "es" | "en" | "pt"): Array<{ variant: string; text: string }> {
  const isQ = /\?\s*$/.test(text) || /^¿/.test(text);
  const out: Array<{ variant: string; text: string }> = [
    { variant: "base", text },
    { variant: "mayúscula", text: capFirst(text) },
    { variant: "sinAcentos", text: noAccents(text) },
    { variant: "puntoFinal", text: isQ ? text : `${text}.` },
    { variant: "dobleEspacio", text: text.replace(" ", "  ") },
    { variant: "espacioSigno", text: isQ ? text.replace(/\?\s*$/, " ?") : `${text} ?`.replace(/ \?$/, "") || text },
  ];
  for (const lead of LEADS[lang]) out.push({ variant: `muletilla:${lead.trim()}`, text: `${lead}${text}` });
  return out.filter((v, i, a) => a.findIndex((o) => o.text === v.text) === i);
}

function fill(template: string, slots: Record<string, string>): string {
  return template.replace(/\{(\w)\}/g, (_, k: string) => slots[k] ?? "");
}

/** El corpus completo, determinista (mismo orden siempre). */
export function buildCorpus(): SweepCase[] {
  const out: SweepCase[] = [];
  const add = (family: Family, lang: "es" | "en" | "pt", template: string, base: string): void => {
    for (const v of variantsOf(base, lang)) out.push({ text: v.text, family, lang, template, variant: v.variant });
  };
  for (const t of REMEMBER_ES) for (const f of FACTS_ES) add("remember", "es", t, fill(t, { F: f }));
  for (const t of REMEMBER_EN) for (const f of FACTS_EN) add("remember", "en", t, fill(t, { F: f }));
  for (const t of REMEMBER_PT) for (const f of FACTS_PT) add("remember", "pt", t, fill(t, { F: f }));
  for (const s of SELF_ES) add("selfFact", "es", s, s);
  for (const s of SELF_EN) add("selfFact", "en", s, s);
  for (const s of SELF_PT) add("selfFact", "pt", s, s);
  for (const t of REMIND_ES) for (const x of TASKS_ES) for (const tm of TIMES_ES) add("reminder", "es", t, fill(t, { T: tm, X: x }));
  for (const t of REMIND_EN) for (const x of TASKS_EN) for (const tm of TIMES_EN) add("reminder", "en", t, fill(t, { T: tm, X: x }));
  for (const t of REMIND_PT) for (const x of TASKS_PT) for (const tm of TIMES_PT) add("reminder", "pt", t, fill(t, { T: tm, X: x }));
  const fixed: Array<[Family, ReadonlyArray<readonly [string, string]>]> = [
    ["timer", TIMER],
    ["note", NOTE],
    ["memoryQuestion", MEMQ],
    ["calc", CALC],
    ["convert", CONVERT],
    ["date", DATE],
    ["chat", CHAT],
    ["contact", CONTACT],
    ["reminderManage", REMINDER_MANAGE],
    ["calendar", CALENDAR],
    ["noteDelete", NOTE_DELETE],
    ["weeklyPlan", WEEKLY_PLAN],
  ];
  for (const [family, list] of fixed) for (const [lang, s] of list) add(family, lang as "es" | "en" | "pt", s, s);
  return out;
}

// ------------------------------------------------------------ simulación

/** Memoria de ejemplo para las preguntas sobre uno mismo. */
export const SWEEP_MEMORY: MemoryQueryData = {
  facts: [
    { content: "Mi cumpleaños es el 3 de mayo", category: "event" },
    { content: "Me llamo Aldo", category: "general" },
    { content: "Vivo en Phoenix", category: "general" },
    { content: "Mi color favorito es el azul", category: "preference" },
    { content: "Mi perro se llama Toby", category: "general" },
    { content: "Dejé el coche en el nivel 3 del estacionamiento", category: "general" },
    { content: "La clave del wifi está en la nevera", category: "general" },
    { content: "Soy vegetariano", category: "preference" },
  ],
  people: [{ name: "Marta", relationship: "mamá" }],
};

/**
 * Por dónde saldría la frase en la app, sin ejecutar el modelo: el mismo
 * orden que ChatScreen (intención + sonda de memoria) y runAgentLoop
 * (vías deterministas antes del modelo).
 */
export function routeOf(text: string, mem: MemoryQueryData = SWEEP_MEMORY, now: Date = new Date(2026, 9, 14, 18, 0)): string {
  let intent = classifyIntent(text);
  const routed = normalizeForRouting(text);
  if (
    intent === "conversar" &&
    ((isGenericMemoryQuestionShape(routed) && memoryGateHit(routed, mem)) || memoryFullCoverageHit(routed, mem))
  ) {
    intent = "recordar";
  }
  text = routed;
  if (intent !== "recordar" && intent !== "actuar") return matchCanned(text) ? "canned" : "chat";
  if (matchCanned(text)) return "canned";
  if (extractCalcAction(text)) return "calc";
  if (extractContactAction(text)) return "contact";
  const tool = extractToolAction(text, now);
  if (tool) return tool.kind;
  if (extractTimerAction(text)) return "timer";
  if (extractReminderAction(text, now)) return "create_reminder";
  if (extractWeeklyPlanAction(text)) return "weekly_plan";
  if (extractPeople(text).length) return "save_person";
  if (extractSelfName(text)) return "self_name";
  if (extractRememberFact(text) ?? extractImplicitFact(text)) return "remember_fact";
  if (answerMemoryQuery(text, mem, "es")) return "memory_query";
  return "model";
}

export interface SweepResult extends SweepCase {
  route: string;
  ok: boolean;
}

export function runSweep(cases: readonly SweepCase[] = buildCorpus()): SweepResult[] {
  return cases.map((c) => {
    const route = routeOf(c.text);
    return { ...c, route, ok: EXPECTED[c.family].includes(route) };
  });
}

export interface FamilySummary {
  family: Family;
  total: number;
  ok: number;
  toModel: number;
  toChat: number;
  wrongRoute: number;
}

export function summarize(results: readonly SweepResult[]): FamilySummary[] {
  const fams = [...new Set(results.map((r) => r.family))];
  return fams.map((family) => {
    const rs = results.filter((r) => r.family === family);
    const bad = rs.filter((r) => !r.ok);
    return {
      family,
      total: rs.length,
      ok: rs.length - bad.length,
      toModel: bad.filter((r) => r.route === "model").length,
      toChat: bad.filter((r) => r.route === "chat").length,
      wrongRoute: bad.filter((r) => r.route !== "model" && r.route !== "chat").length,
    };
  });
}
