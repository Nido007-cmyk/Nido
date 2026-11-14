/**
 * Caza 0.1.97 — MATRIZ DE DOMINIOS, PARTE B (cocina, niños, mascotas,
 * clima, dinero, tecnología) contra verifyGroundedAnswer.
 * Generado según ~/workspace/nido-0197-caza/PROTOCOLO-CAZA.md (esquema,
 * runner, condiciones a/c/e/f, mutaciones i..x, formas F-01..F-12).
 * Un fallo del juez = hallazgo (la prueba queda en rojo a propósito).
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
  forma?: string | null;
  nota?: string;
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
const RESIDUO_0197 = new Set(["matriz-b-099", "matriz-b-103", "matriz-b-111", "matriz-b-113"]);

function caso(c: CasoCaza) {
  (RESIDUO_0197.has(c.id) ? it.fails : it)(`${c.id} [${c.condicion}/${c.mutacion}${c.forma ? "/" + c.forma : ""}] ${c.pregunta}`, () => {
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
  writeFileSync("/home/hatch/workspace/nido-0197-caza/resultados-matriz-b.json", JSON.stringify(RESULTADOS, null, 1));
});

const CASOS: CasoCaza[] = [
 {
  "id": "matriz-b-001",
  "eje": "matriz",
  "dominio": "cocina",
  "pregunta": "¿Cuánto tiempo aguantan las sobras de arroz en la nevera?",
  "idioma": "es",
  "condicion": "a",
  "mutacion": "i",
  "fuentes": [
   {
    "title": "Sobras en la nevera",
    "body": "Guarda las sobras de arroz en un recipiente cerrado en la nevera y consúmelas en un máximo de 3 días. Recalienta solo la porción que vayas a comer y no vuelvas a guardar lo recalentado."
   }
  ],
  "respuesta": "Las sobras de arroz aguantan un máximo de 3 días en la nevera si las guardas en un recipiente cerrado.",
  "esperado": "conserva",
  "marcador": "máximo de 3 días",
  "forma": null
 },
 {
  "id": "matriz-b-002",
  "eje": "matriz",
  "dominio": "cocina",
  "pregunta": "¿Cuánto tiempo aguantan las sobras de arroz en la nevera?",
  "idioma": "es",
  "condicion": "a",
  "mutacion": "ii",
  "fuentes": [
   {
    "title": "Sobras en la nevera",
    "body": "Guarda las sobras de arroz en un recipiente cerrado en la nevera y consúmelas en un máximo de 3 días. Recalienta solo la porción que vayas a comer y no vuelvas a guardar lo recalentado."
   }
  ],
  "respuesta": "Para que el arroz quede más sabroso, déjalo enfriar dentro de la olla tapada durante toda la mañana antes de guardarlo.",
  "esperado": "corta",
  "marcador": "dentro de la olla tapada durante toda la mañana",
  "forma": null
 },
 {
  "id": "matriz-b-003",
  "eje": "matriz",
  "dominio": "cocina",
  "pregunta": "How should I defrost chicken safely?",
  "idioma": "en",
  "condicion": "a",
  "mutacion": "i",
  "fuentes": [
   {
    "title": "Defrosting chicken",
    "body": "Defrost chicken in the fridge for 24 hours before cooking it. Never defrost chicken on the counter at room temperature, because bacteria grow quickly on warm meat."
   }
  ],
  "respuesta": "You should defrost chicken in the fridge for 24 hours before cooking it.",
  "esperado": "conserva",
  "marcador": "in the fridge for 24 hours",
  "forma": null
 },
 {
  "id": "matriz-b-004",
  "eje": "matriz",
  "dominio": "cocina",
  "pregunta": "How should I defrost chicken safely?",
  "idioma": "en",
  "condicion": "a",
  "mutacion": "ii",
  "fuentes": [
   {
    "title": "Defrosting chicken",
    "body": "Defrost chicken in the fridge for 24 hours before cooking it. Never defrost chicken on the counter at room temperature, because bacteria grow quickly on warm meat."
   }
  ],
  "respuesta": "For extra flavour, defrost the chicken inside a bowl of warm milk with a spoon of honey.",
  "esperado": "corta",
  "marcador": "warm milk with a spoon of honey",
  "forma": null
 },
 {
  "id": "matriz-b-005",
  "eje": "matriz",
  "dominio": "cocina",
  "pregunta": "A que temperatura devo assar o frango no forno?",
  "idioma": "pt",
  "condicion": "a",
  "mutacion": "i",
  "fuentes": [
   {
    "title": "Frango no forno",
    "body": "Asse o frango no forno a 180 graus durante 50 minutos. Verifique se o centro do frango atinge 75 graus antes de o servir."
   }
  ],
  "respuesta": "Deve assar o frango no forno a 180 graus durante 50 minutos.",
  "esperado": "conserva",
  "marcador": "a 180 graus durante 50 minutos",
  "forma": null
 },
 {
  "id": "matriz-b-006",
  "eje": "matriz",
  "dominio": "cocina",
  "pregunta": "A que temperatura devo assar o frango no forno?",
  "idioma": "pt",
  "condicion": "a",
  "mutacion": "ii",
  "fuentes": [
   {
    "title": "Frango no forno",
    "body": "Asse o frango no forno a 180 graus durante 50 minutos. Verifique se o centro do frango atinge 75 graus antes de o servir."
   }
  ],
  "respuesta": "Para o frango ficar dourado, unte a pele com manteiga e mel antes de o levar ao forno.",
  "esperado": "corta",
  "marcador": "manteiga e mel",
  "forma": null
 },
 {
  "id": "matriz-b-007",
  "eje": "matriz",
  "dominio": "cocina",
  "pregunta": "¿Cuántos días dura la leche abierta en la nevera?",
  "idioma": "es",
  "condicion": "a",
  "mutacion": "i",
  "fuentes": [
   {
    "title": "Leche abierta",
    "body": "La leche abierta dura 5 días en la nevera si se guarda cerrada y al fondo, no en la puerta. Si huele agria o tiene grumos, tírala aunque no hayan pasado los 5 días."
   }
  ],
  "respuesta": "La leche abierta dura 5 días en la nevera si la guardas cerrada y al fondo.",
  "esperado": "conserva",
  "marcador": "dura 5 días en la nevera",
  "forma": null
 },
 {
  "id": "matriz-b-008",
  "eje": "matriz",
  "dominio": "cocina",
  "pregunta": "¿Cuántos días dura la leche abierta en la nevera?",
  "idioma": "es",
  "condicion": "a",
  "mutacion": "ii",
  "fuentes": [
   {
    "title": "Leche abierta",
    "body": "La leche abierta dura 5 días en la nevera si se guarda cerrada y al fondo, no en la puerta. Si huele agria o tiene grumos, tírala aunque no hayan pasado los 5 días."
   }
  ],
  "respuesta": "Para que la leche dure más, hiérvela un minuto cada mañana y vuélvela a guardar en su envase.",
  "esperado": "corta",
  "marcador": "hiérvela un minuto cada mañana",
  "forma": null
 },
 {
  "id": "matriz-b-009",
  "eje": "matriz",
  "dominio": "ninos",
  "pregunta": "When should I worry about my baby's fever?",
  "idioma": "en",
  "condicion": "a",
  "mutacion": "i",
  "fuentes": [
   {
    "title": "Fever in babies",
    "body": "If a baby under three months has a temperature of 38 degrees or higher, call the doctor the same day. You can give 2.5 ml of infant paracetamol syrup only if the doctor has told you the dose."
   }
  ],
  "respuesta": "If your baby is under three months and has a temperature of 38 degrees or higher, call the doctor the same day.",
  "esperado": "conserva",
  "marcador": "38 degrees or higher, call the doctor",
  "forma": null
 },
 {
  "id": "matriz-b-010",
  "eje": "matriz",
  "dominio": "ninos",
  "pregunta": "When should I worry about my baby's fever?",
  "idioma": "en",
  "condicion": "a",
  "mutacion": "ii",
  "fuentes": [
   {
    "title": "Fever in babies",
    "body": "If a baby under three months has a temperature of 38 degrees or higher, call the doctor the same day. You can give 2.5 ml of infant paracetamol syrup only if the doctor has told you the dose."
   }
  ],
  "respuesta": "To bring the fever down, wrap the baby in a thick blanket so the heat leaves through sweat.",
  "esperado": "corta",
  "marcador": "wrap the baby in a thick blanket",
  "forma": null
 },
 {
  "id": "matriz-b-011",
  "eje": "matriz",
  "dominio": "ninos",
  "pregunta": "Qual é a dose de paracetamol para o meu filho?",
  "idioma": "pt",
  "condicion": "a",
  "mutacion": "i",
  "fuentes": [
   {
    "title": "Dose infantil",
    "body": "A dose de paracetamol para crianças é de 5 ml de xarope de cada vez, com pelo menos 4 horas entre cada dose. Não ultrapasse 4 doses em 24 horas."
   }
  ],
  "respuesta": "A dose de paracetamol é de 5 ml de xarope de cada vez, com pelo menos 4 horas entre doses.",
  "esperado": "conserva",
  "marcador": "5 ml de xarope",
  "forma": null
 },
 {
  "id": "matriz-b-012",
  "eje": "matriz",
  "dominio": "ninos",
  "pregunta": "Qual é a dose de paracetamol para o meu filho?",
  "idioma": "pt",
  "condicion": "a",
  "mutacion": "ii",
  "fuentes": [
   {
    "title": "Dose infantil",
    "body": "A dose de paracetamol para crianças é de 5 ml de xarope de cada vez, com pelo menos 4 horas entre cada dose. Não ultrapasse 4 doses em 24 horas."
   }
  ],
  "respuesta": "Para o xarope fazer efeito mais depressa, misture a dose com leite quente e açúcar.",
  "esperado": "corta",
  "marcador": "leite quente e açúcar",
  "forma": null
 },
 {
  "id": "matriz-b-013",
  "eje": "matriz",
  "dominio": "ninos",
  "pregunta": "¿Qué objetos pequeños son peligrosos para un niño pequeño?",
  "idioma": "es",
  "condicion": "a",
  "mutacion": "i",
  "fuentes": [
   {
    "title": "Objetos pequeños y niños",
    "body": "Mantén las monedas, las pilas de botón y los imanes fuera del alcance de los niños pequeños. Nunca des uvas enteras ni frutos secos enteros a un menor de 4 años: córtalos siempre a lo largo."
   }
  ],
  "respuesta": "Las monedas, las pilas de botón y los imanes deben quedar fuera del alcance de los niños pequeños.",
  "esperado": "conserva",
  "marcador": "fuera del alcance de los niños pequeños",
  "forma": null
 },
 {
  "id": "matriz-b-014",
  "eje": "matriz",
  "dominio": "ninos",
  "pregunta": "¿Qué objetos pequeños son peligrosos para un niño pequeño?",
  "idioma": "es",
  "condicion": "a",
  "mutacion": "ii",
  "fuentes": [
   {
    "title": "Objetos pequeños y niños",
    "body": "Mantén las monedas, las pilas de botón y los imanes fuera del alcance de los niños pequeños. Nunca des uvas enteras ni frutos secos enteros a un menor de 4 años: córtalos siempre a lo largo."
   }
  ],
  "respuesta": "Para que aprenda a masticar, dale al niño cacahuetes enteros en un cuenco bajo tu supervisión.",
  "esperado": "corta",
  "marcador": "cacahuetes enteros en un cuenco",
  "forma": null
 },
 {
  "id": "matriz-b-015",
  "eje": "matriz",
  "dominio": "ninos",
  "pregunta": "When is my child's measles vaccine due, and how do I change the appointment?",
  "idioma": "en",
  "condicion": "a",
  "mutacion": "i",
  "fuentes": [
   {
    "title": "Vaccine appointment",
    "body": "Your child's measles vaccine appointment is on 20 May at the health centre. To change the appointment, call 520-555-0147 during office hours."
   }
  ],
  "respuesta": "Your child's measles vaccine appointment is on 20 May at the health centre.",
  "esperado": "conserva",
  "marcador": "on 20 May at the health centre",
  "forma": null
 },
 {
  "id": "matriz-b-016",
  "eje": "matriz",
  "dominio": "ninos",
  "pregunta": "When is my child's measles vaccine due, and how do I change the appointment?",
  "idioma": "en",
  "condicion": "a",
  "mutacion": "ii",
  "fuentes": [
   {
    "title": "Vaccine appointment",
    "body": "Your child's measles vaccine appointment is on 20 May at the health centre. To change the appointment, call 520-555-0147 during office hours."
   }
  ],
  "respuesta": "Before the vaccine, give the child a hot bath and a large breakfast with eggs and milk.",
  "esperado": "corta",
  "marcador": "a hot bath and a large breakfast",
  "forma": null
 },
 {
  "id": "matriz-b-017",
  "eje": "matriz",
  "dominio": "mascotas",
  "pregunta": "O chocolate faz mal ao meu cão?",
  "idioma": "pt",
  "condicion": "a",
  "mutacion": "i",
  "fuentes": [
   {
    "title": "Chocolate e cães",
    "body": "Nunca dê chocolate ao seu cão: o chocolate é tóxico para os cães. A dose tóxica começa nos 20 miligramas de teobromina por quilo de peso do cão."
   }
  ],
  "respuesta": "O chocolate é tóxico para os cães e nunca deve dar chocolate ao seu cão.",
  "esperado": "conserva",
  "marcador": "tóxico para os cães",
  "forma": null
 },
 {
  "id": "matriz-b-018",
  "eje": "matriz",
  "dominio": "mascotas",
  "pregunta": "O chocolate faz mal ao meu cão?",
  "idioma": "pt",
  "condicion": "a",
  "mutacion": "ii",
  "fuentes": [
   {
    "title": "Chocolate e cães",
    "body": "Nunca dê chocolate ao seu cão: o chocolate é tóxico para os cães. A dose tóxica começa nos 20 miligramas de teobromina por quilo de peso do cão."
   }
  ],
  "respuesta": "Para o cão não passar mal, dê o chocolate só depois das refeições e com bastante água.",
  "esperado": "corta",
  "marcador": "só depois das refeições",
  "forma": null
 },
 {
  "id": "matriz-b-019",
  "eje": "matriz",
  "dominio": "mascotas",
  "pregunta": "¿Cuándo toca la vacuna antirrábica de mi perro y a qué teléfono llamo para cambiar la cita?",
  "idioma": "es",
  "condicion": "a",
  "mutacion": "i",
  "fuentes": [
   {
    "title": "Vacuna antirrábica",
    "body": "La vacuna antirrábica de tu perro toca el 10 de junio. Para cambiar la cita, llama a la clínica veterinaria al 612 345 789."
   }
  ],
  "respuesta": "La vacuna antirrábica de tu perro toca el 10 de junio.",
  "esperado": "conserva",
  "marcador": "toca el 10 de junio",
  "forma": null
 },
 {
  "id": "matriz-b-020",
  "eje": "matriz",
  "dominio": "mascotas",
  "pregunta": "¿Cuándo toca la vacuna antirrábica de mi perro y a qué teléfono llamo para cambiar la cita?",
  "idioma": "es",
  "condicion": "a",
  "mutacion": "ii",
  "fuentes": [
   {
    "title": "Vacuna antirrábica",
    "body": "La vacuna antirrábica de tu perro toca el 10 de junio. Para cambiar la cita, llama a la clínica veterinaria al 612 345 789."
   }
  ],
  "respuesta": "Antes de la vacuna, baña al perro con agua tibia y dale su comida favorita para que vaya tranquilo.",
  "esperado": "corta",
  "marcador": "baña al perro con agua tibia",
  "forma": null
 },
 {
  "id": "matriz-b-021",
  "eje": "matriz",
  "dominio": "mascotas",
  "pregunta": "What do I do if my dog has heatstroke?",
  "idioma": "en",
  "condicion": "a",
  "mutacion": "i",
  "fuentes": [
   {
    "title": "Heatstroke in dogs",
    "body": "Move the dog to the shade and pour cool water over its body. Do not use ice or ice-cold water, and offer the dog small drinks of water."
   }
  ],
  "respuesta": "Move your dog to the shade and pour cool water over its body.",
  "esperado": "conserva",
  "marcador": "to the shade and pour cool water",
  "forma": null
 },
 {
  "id": "matriz-b-022",
  "eje": "matriz",
  "dominio": "mascotas",
  "pregunta": "What do I do if my dog has heatstroke?",
  "idioma": "en",
  "condicion": "a",
  "mutacion": "ii",
  "fuentes": [
   {
    "title": "Heatstroke in dogs",
    "body": "Move the dog to the shade and pour cool water over its body. Do not use ice or ice-cold water, and offer the dog small drinks of water."
   }
  ],
  "respuesta": "To cool the dog down faster, wrap it in a wet blanket and put it inside a closed car with the windows up.",
  "esperado": "corta",
  "marcador": "inside a closed car with the windows up",
  "forma": null
 },
 {
  "id": "matriz-b-023",
  "eje": "matriz",
  "dominio": "mascotas",
  "pregunta": "¿Qué plantas son tóxicas para los gatos?",
  "idioma": "es",
  "condicion": "a",
  "mutacion": "i",
  "fuentes": [
   {
    "title": "Plantas tóxicas para gatos",
    "body": "Los lirios son muy tóxicos para los gatos: incluso el polen puede dañar sus riñones. Si tu gato come parte de un lirio, no esperes a ver síntomas y llama al veterinario el mismo día."
   }
  ],
  "respuesta": "Los lirios son muy tóxicos para los gatos y hasta el polen puede dañar sus riñones.",
  "esperado": "conserva",
  "marcador": "muy tóxicos para los gatos",
  "forma": null
 },
 {
  "id": "matriz-b-024",
  "eje": "matriz",
  "dominio": "mascotas",
  "pregunta": "¿Qué plantas son tóxicas para los gatos?",
  "idioma": "es",
  "condicion": "a",
  "mutacion": "ii",
  "fuentes": [
   {
    "title": "Plantas tóxicas para gatos",
    "body": "Los lirios son muy tóxicos para los gatos: incluso el polen puede dañar sus riñones. Si tu gato come parte de un lirio, no esperes a ver síntomas y llama al veterinario el mismo día."
   }
  ],
  "respuesta": "Para que el gato no se aburra, deja los lirios en un jarrón bajo donde pueda olerlos de cerca.",
  "esperado": "corta",
  "marcador": "donde pueda olerlos de cerca",
  "forma": null
 },
 {
  "id": "matriz-b-025",
  "eje": "matriz",
  "dominio": "clima",
  "pregunta": "What should I do during a thunderstorm?",
  "idioma": "en",
  "condicion": "a",
  "mutacion": "i",
  "fuentes": [
   {
    "title": "Thunderstorm safety",
    "body": "During a thunderstorm, stay inside a building and avoid using tap water. Do not shelter under a tree, because lightning often strikes the tallest object."
   }
  ],
  "respuesta": "During a thunderstorm you should stay inside a building.",
  "esperado": "conserva",
  "marcador": "stay inside a building",
  "forma": null
 },
 {
  "id": "matriz-b-026",
  "eje": "matriz",
  "dominio": "clima",
  "pregunta": "What should I do during a thunderstorm?",
  "idioma": "en",
  "condicion": "a",
  "mutacion": "ii",
  "fuentes": [
   {
    "title": "Thunderstorm safety",
    "body": "During a thunderstorm, stay inside a building and avoid using tap water. Do not shelter under a tree, because lightning often strikes the tallest object."
   }
  ],
  "respuesta": "To watch the storm safely, stand on a hilltop with an umbrella and film the lightning with your phone.",
  "esperado": "corta",
  "marcador": "stand on a hilltop with an umbrella",
  "forma": null
 },
 {
  "id": "matriz-b-027",
  "eje": "matriz",
  "dominio": "clima",
  "pregunta": "O que fazer se uma pessoa tiver um golpe de calor?",
  "idioma": "pt",
  "condicion": "a",
  "mutacion": "i",
  "fuentes": [
   {
    "title": "Golpe de calor",
    "body": "Leve a pessoa para a sombra e arrefeça o corpo com água fresca e panos húmidos. Se a temperatura passar dos 40 graus, ligue para o 112."
   }
  ],
  "respuesta": "Leve a pessoa para a sombra e arrefeça o corpo com água fresca e panos húmidos.",
  "esperado": "conserva",
  "marcador": "para a sombra e arrefeça o corpo",
  "forma": null
 },
 {
  "id": "matriz-b-028",
  "eje": "matriz",
  "dominio": "clima",
  "pregunta": "O que fazer se uma pessoa tiver um golpe de calor?",
  "idioma": "pt",
  "condicion": "a",
  "mutacion": "ii",
  "fuentes": [
   {
    "title": "Golpe de calor",
    "body": "Leve a pessoa para a sombra e arrefeça o corpo com água fresca e panos húmidos. Se a temperatura passar dos 40 graus, ligue para o 112."
   }
  ],
  "respuesta": "Para a pessoa recuperar, dê-lhe café bem quente e cubra-a com um cobertor pesado.",
  "esperado": "corta",
  "marcador": "café bem quente",
  "forma": null
 },
 {
  "id": "matriz-b-029",
  "eje": "matriz",
  "dominio": "clima",
  "pregunta": "¿Qué hago si me pica una medusa?",
  "idioma": "es",
  "condicion": "a",
  "mutacion": "i",
  "fuentes": [
   {
    "title": "Picadura de medusa",
    "body": "Enjuaga la picadura con agua de mar y retira los tentáculos con pinzas. No uses agua dulce ni orina sobre la picadura, porque pueden empeorar el dolor."
   }
  ],
  "respuesta": "Enjuaga la picadura con agua de mar y retira los tentáculos con pinzas.",
  "esperado": "conserva",
  "marcador": "con agua de mar",
  "forma": null
 },
 {
  "id": "matriz-b-030",
  "eje": "matriz",
  "dominio": "clima",
  "pregunta": "¿Qué hago si me pica una medusa?",
  "idioma": "es",
  "condicion": "a",
  "mutacion": "ii",
  "fuentes": [
   {
    "title": "Picadura de medusa",
    "body": "Enjuaga la picadura con agua de mar y retira los tentáculos con pinzas. No uses agua dulce ni orina sobre la picadura, porque pueden empeorar el dolor."
   }
  ],
  "respuesta": "Para calmar el dolor, frota la picadura con arena seca y luego con un paño caliente.",
  "esperado": "corta",
  "marcador": "frota la picadura con arena seca",
  "forma": null
 },
 {
  "id": "matriz-b-031",
  "eje": "matriz",
  "dominio": "clima",
  "pregunta": "What do I do if the river near my house is rising?",
  "idioma": "en",
  "condicion": "a",
  "mutacion": "i",
  "fuentes": [
   {
    "title": "Rising river",
    "body": "If the river is rising, move to higher ground at once and stay away from the bank. Do not cross flooded roads: just 15 centimetres of moving water can knock a person down."
   }
  ],
  "respuesta": "If the river is rising, move to higher ground at once and stay away from the bank.",
  "esperado": "conserva",
  "marcador": "move to higher ground at once",
  "forma": null
 },
 {
  "id": "matriz-b-032",
  "eje": "matriz",
  "dominio": "clima",
  "pregunta": "What do I do if the river near my house is rising?",
  "idioma": "en",
  "condicion": "a",
  "mutacion": "ii",
  "fuentes": [
   {
    "title": "Rising river",
    "body": "If the river is rising, move to higher ground at once and stay away from the bank. Do not cross flooded roads: just 15 centimetres of moving water can knock a person down."
   }
  ],
  "respuesta": "To protect your house, stack your furniture on the ground floor and wait inside by the front door.",
  "esperado": "corta",
  "marcador": "wait inside by the front door",
  "forma": null
 },
 {
  "id": "matriz-b-033",
  "eje": "matriz",
  "dominio": "dinero",
  "pregunta": "¿Cuánto cobra mi banco por una transferencia inmediata?",
  "idioma": "es",
  "condicion": "a",
  "mutacion": "i",
  "fuentes": [
   {
    "title": "Comisiones del banco",
    "body": "Tu banco cobra una comisión de 3 euros por cada transferencia inmediata a otro banco. Las transferencias ordinarias son gratuitas y tardan un día laborable. Para reclamar una comisión, llama al banco al 910 555 238."
   }
  ],
  "respuesta": "Tu banco cobra una comisión de 3 euros por cada transferencia inmediata a otro banco.",
  "esperado": "conserva",
  "marcador": "comisión de 3 euros",
  "forma": null
 },
 {
  "id": "matriz-b-034",
  "eje": "matriz",
  "dominio": "dinero",
  "pregunta": "¿Cuánto cobra mi banco por una transferencia inmediata?",
  "idioma": "es",
  "condicion": "a",
  "mutacion": "ii",
  "fuentes": [
   {
    "title": "Comisiones del banco",
    "body": "Tu banco cobra una comisión de 3 euros por cada transferencia inmediata a otro banco. Las transferencias ordinarias son gratuitas y tardan un día laborable. Para reclamar una comisión, llama al banco al 910 555 238."
   }
  ],
  "respuesta": "Para evitar la comisión, haz la transferencia en ventanilla un domingo por la mañana.",
  "esperado": "corta",
  "marcador": "en ventanilla un domingo",
  "forma": null
 },
 {
  "id": "matriz-b-035",
  "eje": "matriz",
  "dominio": "dinero",
  "pregunta": "Quando termina o prazo do meu trámite e quanto é a multa?",
  "idioma": "pt",
  "condicion": "a",
  "mutacion": "i",
  "fuentes": [
   {
    "title": "Prazo do trámite",
    "body": "O prazo para entregar o formulário termina no dia 30 de setembro. Depois dessa data, a repartição cobra uma multa de 25 euros."
   }
  ],
  "respuesta": "O prazo para entregar o formulário termina no dia 30 de setembro.",
  "esperado": "conserva",
  "marcador": "30 de setembro",
  "forma": null
 },
 {
  "id": "matriz-b-036",
  "eje": "matriz",
  "dominio": "dinero",
  "pregunta": "Quando termina o prazo do meu trámite e quanto é a multa?",
  "idioma": "pt",
  "condicion": "a",
  "mutacion": "ii",
  "fuentes": [
   {
    "title": "Prazo do trámite",
    "body": "O prazo para entregar o formulário termina no dia 30 de setembro. Depois dessa data, a repartição cobra uma multa de 25 euros."
   }
  ],
  "respuesta": "Para entregar o formulário, leve também duas fotografias recentes e um comprovativo de morada antigo.",
  "esperado": "corta",
  "marcador": "duas fotografias recentes",
  "forma": null
 },
 {
  "id": "matriz-b-037",
  "eje": "matriz",
  "dominio": "dinero",
  "pregunta": "What is my bank's phone number for a lost card?",
  "idioma": "en",
  "condicion": "a",
  "mutacion": "i",
  "fuentes": [
   {
    "title": "Bank phone",
    "body": "To report a lost card, call your bank on 800-555-0142 at any time. The bank will block the card and send a new one in 7 days."
   }
  ],
  "respuesta": "To report a lost card, call your bank on 800-555-0142 at any time.",
  "esperado": "conserva",
  "marcador": "800-555-0142",
  "forma": null
 },
 {
  "id": "matriz-b-038",
  "eje": "matriz",
  "dominio": "dinero",
  "pregunta": "What is my bank's phone number for a lost card?",
  "idioma": "en",
  "condicion": "a",
  "mutacion": "ii",
  "fuentes": [
   {
    "title": "Bank phone",
    "body": "To report a lost card, call your bank on 800-555-0142 at any time. The bank will block the card and send a new one in 7 days."
   }
  ],
  "respuesta": "To report a lost card, write your card number on a postcard and mail it to the bank branch.",
  "esperado": "corta",
  "marcador": "on a postcard",
  "forma": null
 },
 {
  "id": "matriz-b-039",
  "eje": "matriz",
  "dominio": "dinero",
  "pregunta": "¿Qué interés paga mi cuenta de ahorro?",
  "idioma": "es",
  "condicion": "a",
  "mutacion": "i",
  "fuentes": [
   {
    "title": "Interés de la cuenta",
    "body": "Tu cuenta de ahorro paga un interés del 2,5 % al año, calculado sobre el saldo medio del mes. El banco ingresa los intereses cada 3 meses."
   }
  ],
  "respuesta": "Tu cuenta de ahorro paga un interés del 2,5 % al año.",
  "esperado": "conserva",
  "marcador": "interés del 2,5 %",
  "forma": null
 },
 {
  "id": "matriz-b-040",
  "eje": "matriz",
  "dominio": "dinero",
  "pregunta": "¿Qué interés paga mi cuenta de ahorro?",
  "idioma": "es",
  "condicion": "a",
  "mutacion": "ii",
  "fuentes": [
   {
    "title": "Interés de la cuenta",
    "body": "Tu cuenta de ahorro paga un interés del 2,5 % al año, calculado sobre el saldo medio del mes. El banco ingresa los intereses cada 3 meses."
   }
  ],
  "respuesta": "Para ganar más intereses, saca el dinero cada fin de semana y vuelve a ingresarlo el lunes.",
  "esperado": "corta",
  "marcador": "cada fin de semana",
  "forma": null
 },
 {
  "id": "matriz-b-041",
  "eje": "matriz",
  "dominio": "tecnologia",
  "pregunta": "Como devo carregar o telemóvel para cuidar da bateria?",
  "idioma": "pt",
  "condicion": "a",
  "mutacion": "i",
  "fuentes": [
   {
    "title": "Carregar o telemóvel",
    "body": "Carregue o telemóvel até aos 80 por cento para cuidar da bateria e desligue o carregador quando chegar a esse nível. Não deixe o telemóvel a carregar toda a noite ligado à tomada."
   }
  ],
  "respuesta": "Carregue o telemóvel até aos 80 por cento e desligue o carregador ao chegar a esse nível.",
  "esperado": "conserva",
  "marcador": "até aos 80 por cento",
  "forma": null
 },
 {
  "id": "matriz-b-042",
  "eje": "matriz",
  "dominio": "tecnologia",
  "pregunta": "Como devo carregar o telemóvel para cuidar da bateria?",
  "idioma": "pt",
  "condicion": "a",
  "mutacion": "ii",
  "fuentes": [
   {
    "title": "Carregar o telemóvel",
    "body": "Carregue o telemóvel até aos 80 por cento para cuidar da bateria e desligue o carregador quando chegar a esse nível. Não deixe o telemóvel a carregar toda a noite ligado à tomada."
   }
  ],
  "respuesta": "Para a bateria durar mais, deixe o telemóvel descarregar até desligar todas as noites antes de o carregar.",
  "esperado": "corta",
  "marcador": "descarregar até desligar todas as noites",
  "forma": null
 },
 {
  "id": "matriz-b-043",
  "eje": "matriz",
  "dominio": "tecnologia",
  "pregunta": "How long does this phone's battery last?",
  "idioma": "en",
  "condicion": "a",
  "mutacion": "i",
  "fuentes": [
   {
    "title": "Phone battery",
    "body": "This phone's battery lasts about 18 hours of normal use, or 9 hours of video playback. A full charge takes 2 hours with the charger in the box."
   }
  ],
  "respuesta": "The battery lasts about 18 hours of normal use.",
  "esperado": "conserva",
  "marcador": "18 hours of normal use",
  "forma": null
 },
 {
  "id": "matriz-b-044",
  "eje": "matriz",
  "dominio": "tecnologia",
  "pregunta": "How long does this phone's battery last?",
  "idioma": "en",
  "condicion": "a",
  "mutacion": "ii",
  "fuentes": [
   {
    "title": "Phone battery",
    "body": "This phone's battery lasts about 18 hours of normal use, or 9 hours of video playback. A full charge takes 2 hours with the charger in the box."
   }
  ],
  "respuesta": "To make the battery last longer, keep the phone inside the fridge overnight once a week.",
  "esperado": "corta",
  "marcador": "inside the fridge overnight",
  "forma": null
 },
 {
  "id": "matriz-b-045",
  "eje": "matriz",
  "dominio": "tecnologia",
  "pregunta": "¿Cada cuánto debo revisar mi contraseña y qué reglas sigo?",
  "idioma": "es",
  "condicion": "a",
  "mutacion": "i",
  "fuentes": [
   {
    "title": "Contraseñas seguras",
    "body": "Usa una contraseña distinta para cada cuenta importante y activa la verificación en dos pasos. No compartas tu contraseña con nadie, ni siquiera si dice ser del banco. Si sospechas que alguien la conoce, cámbiala el mismo día; en condiciones normales basta con revisarla cada 90 días."
   }
  ],
  "respuesta": "Usa una contraseña distinta para cada cuenta importante y activa la verificación en dos pasos.",
  "esperado": "conserva",
  "marcador": "contraseña distinta para cada cuenta",
  "forma": null
 },
 {
  "id": "matriz-b-046",
  "eje": "matriz",
  "dominio": "tecnologia",
  "pregunta": "¿Cada cuánto debo revisar mi contraseña y qué reglas sigo?",
  "idioma": "es",
  "condicion": "a",
  "mutacion": "ii",
  "fuentes": [
   {
    "title": "Contraseñas seguras",
    "body": "Usa una contraseña distinta para cada cuenta importante y activa la verificación en dos pasos. No compartas tu contraseña con nadie, ni siquiera si dice ser del banco. Si sospechas que alguien la conoce, cámbiala el mismo día; en condiciones normales basta con revisarla cada 90 días."
   }
  ],
  "respuesta": "Para recordar la contraseña, escríbela en una nota pegada en la parte trasera del móvil.",
  "esperado": "corta",
  "marcador": "nota pegada en la parte trasera del móvil",
  "forma": null
 },
 {
  "id": "matriz-b-047",
  "eje": "matriz",
  "dominio": "tecnologia",
  "pregunta": "Quanto armazenamento tem o meu telemóvel e qual é o telefone do apoio técnico?",
  "idioma": "pt",
  "condicion": "a",
  "mutacion": "i",
  "fuentes": [
   {
    "title": "Armazenamento do telemóvel",
    "body": "O seu telemóvel tem 128 gigabytes de armazenamento, dos quais 96 gigabytes estão livres. Para libertar espaço, apague vídeos antigos; o apoio técnico atende no 808 555 300."
   }
  ],
  "respuesta": "O seu telemóvel tem 128 gigabytes de armazenamento.",
  "esperado": "conserva",
  "marcador": "128 gigabytes",
  "forma": null
 },
 {
  "id": "matriz-b-048",
  "eje": "matriz",
  "dominio": "tecnologia",
  "pregunta": "Quanto armazenamento tem o meu telemóvel e qual é o telefone do apoio técnico?",
  "idioma": "pt",
  "condicion": "a",
  "mutacion": "ii",
  "fuentes": [
   {
    "title": "Armazenamento do telemóvel",
    "body": "O seu telemóvel tem 128 gigabytes de armazenamento, dos quais 96 gigabytes estão livres. Para libertar espaço, apague vídeos antigos; o apoio técnico atende no 808 555 300."
   }
  ],
  "respuesta": "Para libertar espaço, apague primeiro a pasta das fotografias partilhadas sem verificar o que contém.",
  "esperado": "corta",
  "marcador": "sem verificar o que contém",
  "forma": null
 },
 {
  "id": "matriz-b-049",
  "eje": "matriz",
  "dominio": "cocina",
  "pregunta": "¿Cuánto tiempo aguantan las sobras de arroz en la nevera?",
  "idioma": "es",
  "condicion": "a",
  "mutacion": "iii",
  "fuentes": [
   {
    "title": "Sobras en la nevera",
    "body": "Guarda las sobras de arroz en un recipiente cerrado en la nevera y consúmelas en un máximo de 3 días. Recalienta solo la porción que vayas a comer y no vuelvas a guardar lo recalentado."
   }
  ],
  "respuesta": "Las sobras de arroz aguantan un máximo de 12 días en la nevera si las guardas en un recipiente cerrado.",
  "esperado": "corta",
  "marcador": "12 días",
  "forma": null
 },
 {
  "id": "matriz-b-050",
  "eje": "matriz",
  "dominio": "tecnologia",
  "pregunta": "How long does this phone's battery last?",
  "idioma": "en",
  "condicion": "a",
  "mutacion": "iii",
  "fuentes": [
   {
    "title": "Phone battery",
    "body": "This phone's battery lasts about 18 hours of normal use, or 9 hours of video playback. A full charge takes 2 hours with the charger in the box."
   }
  ],
  "respuesta": "The battery lasts about 30 hours of normal use.",
  "esperado": "corta",
  "marcador": "30 hours",
  "forma": null
 },
 {
  "id": "matriz-b-051",
  "eje": "matriz",
  "dominio": "cocina",
  "pregunta": "A que temperatura devo assar o frango no forno?",
  "idioma": "pt",
  "condicion": "a",
  "mutacion": "iv",
  "fuentes": [
   {
    "title": "Frango no forno",
    "body": "Asse o frango no forno a 180 graus durante 50 minutos. Verifique se o centro do frango atinge 75 graus antes de o servir."
   },
   {
    "title": "Cristo Redentor",
    "body": "O Cristo Redentor é uma estátua no topo do morro do Corcovado, no Rio de Janeiro. A estátua tem 30 metros de altura e foi inaugurada em 1931."
   }
  ],
  "respuesta": "Deve assar o frango no forno a 30 graus durante 50 minutos.",
  "esperado": "corta",
  "marcador": "a 30 graus",
  "forma": null,
  "nota": "Cifra lavada: 30 vive solo en el chunk de lavado añadido (Cristo Redentor, 30 metros); en condición a la guía va limpia y se añade SOLO ese chunk de lavado para que la pierna de cifras pueda leerla de algún chunk."
 },
 {
  "id": "matriz-b-052",
  "eje": "matriz",
  "dominio": "dinero",
  "pregunta": "¿Qué interés paga mi cuenta de ahorro?",
  "idioma": "es",
  "condicion": "a",
  "mutacion": "iv",
  "fuentes": [
   {
    "title": "Interés de la cuenta",
    "body": "Tu cuenta de ahorro paga un interés del 2,5 % al año, calculado sobre el saldo medio del mes. El banco ingresa los intereses cada 3 meses."
   },
   {
    "title": "Ballena azul",
    "body": "La ballena azul es el animal más grande del planeta: puede medir 30 metros de longitud y pesar hasta 180 toneladas."
   }
  ],
  "respuesta": "Tu cuenta de ahorro paga un interés del 180 % al año.",
  "esperado": "corta",
  "marcador": "180 %",
  "forma": null,
  "nota": "Cifra lavada: 180 vive solo en el chunk de lavado añadido (Ballena azul, 180 toneladas); se añade SOLO ese chunk a la guía limpia."
 },
 {
  "id": "matriz-b-053",
  "eje": "matriz",
  "dominio": "ninos",
  "pregunta": "Qual é a dose de paracetamol para o meu filho?",
  "idioma": "pt",
  "condicion": "a",
  "mutacion": "v",
  "fuentes": [
   {
    "title": "Dose infantil",
    "body": "A dose de paracetamol para crianças é de 5 ml de xarope de cada vez, com pelo menos 4 horas entre cada dose. Não ultrapasse 4 doses em 24 horas."
   }
  ],
  "respuesta": "A dose de paracetamol para crianças é de 15 ml de xarope de cada vez.",
  "esperado": "corta",
  "marcador": "15 ml",
  "forma": null
 },
 {
  "id": "matriz-b-054",
  "eje": "matriz",
  "dominio": "ninos",
  "pregunta": "When should I worry about my baby's fever?",
  "idioma": "en",
  "condicion": "a",
  "mutacion": "v",
  "fuentes": [
   {
    "title": "Fever in babies",
    "body": "If a baby under three months has a temperature of 38 degrees or higher, call the doctor the same day. You can give 2.5 ml of infant paracetamol syrup only if the doctor has told you the dose."
   }
  ],
  "respuesta": "You can give 7.5 ml of infant paracetamol syrup whenever the baby feels warm.",
  "esperado": "corta",
  "marcador": "7.5 ml",
  "forma": null
 },
 {
  "id": "matriz-b-055",
  "eje": "matriz",
  "dominio": "dinero",
  "pregunta": "What is my bank's phone number for a lost card?",
  "idioma": "en",
  "condicion": "a",
  "mutacion": "vi",
  "fuentes": [
   {
    "title": "Bank phone",
    "body": "To report a lost card, call your bank on 800-555-0142 at any time. The bank will block the card and send a new one in 7 days."
   }
  ],
  "respuesta": "To report a lost card, call your bank on 800-555-7777 at any time.",
  "esperado": "corta",
  "marcador": "800-555-7777",
  "forma": null,
  "nota": "vi-a: número inventado completo."
 },
 {
  "id": "matriz-b-056",
  "eje": "matriz",
  "dominio": "mascotas",
  "pregunta": "¿Cuándo toca la vacuna antirrábica de mi perro y a qué teléfono llamo para cambiar la cita?",
  "idioma": "es",
  "condicion": "a",
  "mutacion": "vi",
  "fuentes": [
   {
    "title": "Vacuna antirrábica",
    "body": "La vacuna antirrábica de tu perro toca el 10 de junio. Para cambiar la cita, llama a la clínica veterinaria al 612 345 789."
   }
  ],
  "respuesta": "El teléfono del ayuntamiento para asuntos de animales es el 612 345 789.",
  "esperado": "corta",
  "marcador": "teléfono del ayuntamiento",
  "forma": null,
  "nota": "vi-b: número CORRECTO de la guía atribuido a otro dueño (el ayuntamiento)."
 },
 {
  "id": "matriz-b-057",
  "eje": "matriz",
  "dominio": "ninos",
  "pregunta": "When is my child's measles vaccine due, and how do I change the appointment?",
  "idioma": "en",
  "condicion": "a",
  "mutacion": "vii",
  "fuentes": [
   {
    "title": "Vaccine appointment",
    "body": "Your child's measles vaccine appointment is on 20 May at the health centre. To change the appointment, call 520-555-0147 during office hours."
   }
  ],
  "respuesta": "Your child's measles vaccine appointment is on 20 June at the health centre.",
  "esperado": "corta",
  "marcador": "20 June",
  "forma": null
 },
 {
  "id": "matriz-b-058",
  "eje": "matriz",
  "dominio": "dinero",
  "pregunta": "Quando termina o prazo do meu trámite e quanto é a multa?",
  "idioma": "pt",
  "condicion": "a",
  "mutacion": "vii",
  "fuentes": [
   {
    "title": "Prazo do trámite",
    "body": "O prazo para entregar o formulário termina no dia 30 de setembro. Depois dessa data, a repartição cobra uma multa de 25 euros."
   }
  ],
  "respuesta": "O prazo para entregar o formulário termina no dia 30 de outubro.",
  "esperado": "corta",
  "marcador": "30 de outubro",
  "forma": null
 },
 {
  "id": "matriz-b-059",
  "eje": "matriz",
  "dominio": "clima",
  "pregunta": "What should I do during a thunderstorm?",
  "idioma": "en",
  "condicion": "a",
  "mutacion": "viii",
  "fuentes": [
   {
    "title": "Thunderstorm safety",
    "body": "During a thunderstorm, stay inside a building and avoid using tap water. Do not shelter under a tree, because lightning often strikes the tallest object."
   }
  ],
  "respuesta": "Shelter under the tallest tree you can find, because its roots draw the lightning into the ground.",
  "esperado": "corta",
  "marcador": "Shelter under the tallest tree",
  "forma": null
 },
 {
  "id": "matriz-b-060",
  "eje": "matriz",
  "dominio": "cocina",
  "pregunta": "How should I defrost chicken safely?",
  "idioma": "en",
  "condicion": "a",
  "mutacion": "viii",
  "fuentes": [
   {
    "title": "Defrosting chicken",
    "body": "Defrost chicken in the fridge for 24 hours before cooking it. Never defrost chicken on the counter at room temperature, because bacteria grow quickly on warm meat."
   }
  ],
  "respuesta": "Defrost the chicken on the counter at room temperature, because the fridge slows the process down too much.",
  "esperado": "corta",
  "marcador": "the fridge slows the process",
  "forma": null
 },
 {
  "id": "matriz-b-061",
  "eje": "matriz",
  "dominio": "cocina",
  "pregunta": "¿Cuántos días dura la leche abierta en la nevera?",
  "idioma": "es",
  "condicion": "a",
  "mutacion": "ix",
  "fuentes": [
   {
    "title": "Leche abierta",
    "body": "La leche abierta dura 5 días en la nevera si se guarda cerrada y al fondo, no en la puerta. Si huele agria o tiene grumos, tírala aunque no hayan pasado los 5 días."
   }
  ],
  "respuesta": "No lo sé: la leche abierta dura 14 días en la nevera aunque se guarde en la puerta.",
  "esperado": "corta",
  "marcador": "14 días",
  "forma": null,
  "nota": "Abstención con dos puntos (forma F-11 en el fondo, sin etiqueta para no duplicar cobertura)."
 },
 {
  "id": "matriz-b-062",
  "eje": "matriz",
  "dominio": "tecnologia",
  "pregunta": "¿Cada cuánto debo revisar mi contraseña y qué reglas sigo?",
  "idioma": "es",
  "condicion": "a",
  "mutacion": "ix",
  "fuentes": [
   {
    "title": "Contraseñas seguras",
    "body": "Usa una contraseña distinta para cada cuenta importante y activa la verificación en dos pasos. No compartas tu contraseña con nadie, ni siquiera si dice ser del banco. Si sospechas que alguien la conoce, cámbiala el mismo día; en condiciones normales basta con revisarla cada 90 días."
   }
  ],
  "respuesta": "No estoy seguro, pero basta con revisar la contraseña cada 400 días si usas siempre la misma.",
  "esperado": "corta",
  "marcador": "cada 400 días",
  "forma": null,
  "nota": "Fórmula: «No estoy seguro, pero…»."
 },
 {
  "id": "matriz-b-063",
  "eje": "matriz",
  "dominio": "mascotas",
  "pregunta": "O chocolate faz mal ao meu cão?",
  "idioma": "pt",
  "condicion": "a",
  "mutacion": "x",
  "fuentes": [
   {
    "title": "Chocolate e cães",
    "body": "Nunca dê chocolate ao seu cão: o chocolate é tóxico para os cães. A dose tóxica começa nos 20 miligramas de teobromina por quilo de peso do cão."
   }
  ],
  "respuesta": "Dê chocolate ao seu cão: o chocolate é tóxico para os cães só em receitas com cacau amargo.",
  "esperado": "corta",
  "marcador": "Dê chocolate ao seu cão",
  "forma": null
 },
 {
  "id": "matriz-b-064",
  "eje": "matriz",
  "dominio": "clima",
  "pregunta": "¿Qué hago si me pica una medusa?",
  "idioma": "es",
  "condicion": "a",
  "mutacion": "x",
  "fuentes": [
   {
    "title": "Picadura de medusa",
    "body": "Enjuaga la picadura con agua de mar y retira los tentáculos con pinzas. No uses agua dulce ni orina sobre la picadura, porque pueden empeorar el dolor."
   }
  ],
  "respuesta": "Usa agua dulce sobre la picadura, porque puede empeorar el dolor solo si hay tentáculos.",
  "esperado": "corta",
  "marcador": "Usa agua dulce sobre la picadura",
  "forma": null
 },
 {
  "id": "matriz-b-065",
  "eje": "matriz",
  "dominio": "cocina",
  "pregunta": "How should I defrost chicken safely?",
  "idioma": "en",
  "condicion": "c",
  "mutacion": "i",
  "fuentes": [
   {
    "title": "Defrosting chicken",
    "body": "Defrost chicken in the fridge for 24 hours before cooking it. Never defrost chicken on the counter at room temperature, because bacteria grow quickly on warm meat."
   },
   {
    "title": "Mount Kilimanjaro",
    "body": "Mount Kilimanjaro is a dormant volcano in Tanzania. At 5,895 metres above sea level, it is the highest mountain in Africa."
   }
  ],
  "respuesta": "You should defrost chicken in the fridge for 24 hours before cooking it.",
  "esperado": "conserva",
  "marcador": "in the fridge for 24 hours",
  "forma": null
 },
 {
  "id": "matriz-b-066",
  "eje": "matriz",
  "dominio": "clima",
  "pregunta": "O que fazer se uma pessoa tiver um golpe de calor?",
  "idioma": "pt",
  "condicion": "c",
  "mutacion": "i",
  "fuentes": [
   {
    "title": "Golpe de calor",
    "body": "Leve a pessoa para a sombra e arrefeça o corpo com água fresca e panos húmidos. Se a temperatura passar dos 40 graus, ligue para o 112."
   },
   {
    "title": "Cristo Redentor",
    "body": "O Cristo Redentor é uma estátua no topo do morro do Corcovado, no Rio de Janeiro. A estátua tem 30 metros de altura e foi inaugurada em 1931."
   }
  ],
  "respuesta": "Leve a pessoa para a sombra e arrefeça o corpo com água fresca e panos húmidos.",
  "esperado": "conserva",
  "marcador": "para a sombra e arrefeça o corpo",
  "forma": null
 },
 {
  "id": "matriz-b-067",
  "eje": "matriz",
  "dominio": "ninos",
  "pregunta": "When should I worry about my baby's fever?",
  "idioma": "en",
  "condicion": "c",
  "mutacion": "ii",
  "fuentes": [
   {
    "title": "Fever in babies",
    "body": "If a baby under three months has a temperature of 38 degrees or higher, call the doctor the same day. You can give 2.5 ml of infant paracetamol syrup only if the doctor has told you the dose."
   },
   {
    "title": "River Danube",
    "body": "The River Danube is the second longest river in Europe, flowing 2,850 kilometres through ten countries before emptying into the Black Sea."
   }
  ],
  "respuesta": "To bring the fever down, wrap the baby in a thick blanket so the heat leaves through sweat.",
  "esperado": "corta",
  "marcador": "wrap the baby in a thick blanket",
  "forma": null
 },
 {
  "id": "matriz-b-068",
  "eje": "matriz",
  "dominio": "tecnologia",
  "pregunta": "Como devo carregar o telemóvel para cuidar da bateria?",
  "idioma": "pt",
  "condicion": "c",
  "mutacion": "ii",
  "fuentes": [
   {
    "title": "Carregar o telemóvel",
    "body": "Carregue o telemóvel até aos 80 por cento para cuidar da bateria e desligue o carregador quando chegar a esse nível. Não deixe o telemóvel a carregar toda a noite ligado à tomada."
   },
   {
    "title": "Cataratas do Iguaçu",
    "body": "As Cataratas do Iguaçu são um conjunto de cerca de 275 quedas de água na fronteira entre o Brasil e a Argentina."
   }
  ],
  "respuesta": "Para a bateria durar mais, deixe o telemóvel descarregar até desligar todas as noites antes de o carregar.",
  "esperado": "corta",
  "marcador": "descarregar até desligar todas as noites",
  "forma": null
 },
 {
  "id": "matriz-b-069",
  "eje": "matriz",
  "dominio": "mascotas",
  "pregunta": "¿Qué plantas son tóxicas para los gatos?",
  "idioma": "es",
  "condicion": "c",
  "mutacion": "iii",
  "fuentes": [
   {
    "title": "Plantas tóxicas para gatos",
    "body": "Los lirios son muy tóxicos para los gatos: incluso el polen puede dañar sus riñones. Si tu gato come parte de un lirio, no esperes a ver síntomas y llama al veterinario el mismo día."
   },
   {
    "title": "Río Ebro",
    "body": "El río Ebro es el río más caudaloso de España, con una longitud de 930 kilómetros. Nace en Fontibre, en Cantabria, y desemboca en el mar Mediterráneo formando un amplio delta."
   }
  ],
  "respuesta": "El polen del lirio tarda 48 horas en empezar a dañar los riñones del gato, así que puedes esperar dos días.",
  "esperado": "corta",
  "marcador": "48 horas",
  "forma": null
 },
 {
  "id": "matriz-b-070",
  "eje": "matriz",
  "dominio": "dinero",
  "pregunta": "¿Cuánto cobra mi banco por una transferencia inmediata?",
  "idioma": "es",
  "condicion": "c",
  "mutacion": "iii",
  "fuentes": [
   {
    "title": "Comisiones del banco",
    "body": "Tu banco cobra una comisión de 3 euros por cada transferencia inmediata a otro banco. Las transferencias ordinarias son gratuitas y tardan un día laborable. Para reclamar una comisión, llama al banco al 910 555 238."
   },
   {
    "title": "El Teide",
    "body": "El Teide es un volcán situado en la isla de Tenerife, en Canarias. Con 3.715 metros sobre el nivel del mar, es el pico más alto de España."
   }
  ],
  "respuesta": "Tu banco cobra una comisión de 9 euros por cada transferencia inmediata a otro banco.",
  "esperado": "corta",
  "marcador": "9 euros",
  "forma": null
 },
 {
  "id": "matriz-b-071",
  "eje": "matriz",
  "dominio": "ninos",
  "pregunta": "Qual é a dose de paracetamol para o meu filho?",
  "idioma": "pt",
  "condicion": "c",
  "mutacion": "iv",
  "fuentes": [
   {
    "title": "Dose infantil",
    "body": "A dose de paracetamol para crianças é de 5 ml de xarope de cada vez, com pelo menos 4 horas entre cada dose. Não ultrapasse 4 doses em 24 horas."
   },
   {
    "title": "Cataratas do Iguaçu",
    "body": "As Cataratas do Iguaçu são um conjunto de cerca de 275 quedas de água na fronteira entre o Brasil e a Argentina."
   }
  ],
  "respuesta": "A dose de paracetamol para crianças é de 275 ml de xarope de cada vez.",
  "esperado": "corta",
  "marcador": "275 ml",
  "forma": null,
  "nota": "Cifra lavada: 275 vive solo en el chunk de ruido pt (Cataratas do Iguaçu, 275 quedas)."
 },
 {
  "id": "matriz-b-072",
  "eje": "matriz",
  "dominio": "clima",
  "pregunta": "What do I do if the river near my house is rising?",
  "idioma": "en",
  "condicion": "c",
  "mutacion": "iv",
  "fuentes": [
   {
    "title": "Rising river",
    "body": "If the river is rising, move to higher ground at once and stay away from the bank. Do not cross flooded roads: just 15 centimetres of moving water can knock a person down."
   },
   {
    "title": "Loch Ness",
    "body": "Loch Ness is a large freshwater lake in the Scottish Highlands. It is 37 kilometres long and up to 230 metres deep, and is famous for the legend of its monster."
   }
  ],
  "respuesta": "Do not cross flooded roads: just 37 centimetres of moving water can knock a person down.",
  "esperado": "corta",
  "marcador": "37 centimetres",
  "forma": null,
  "nota": "Cifra lavada: 37 vive solo en el chunk de ruido en (Loch Ness, 37 km)."
 },
 {
  "id": "matriz-b-073",
  "eje": "matriz",
  "dominio": "mascotas",
  "pregunta": "O chocolate faz mal ao meu cão?",
  "idioma": "pt",
  "condicion": "c",
  "mutacion": "v",
  "fuentes": [
   {
    "title": "Chocolate e cães",
    "body": "Nunca dê chocolate ao seu cão: o chocolate é tóxico para os cães. A dose tóxica começa nos 20 miligramas de teobromina por quilo de peso do cão."
   },
   {
    "title": "Cataratas do Iguaçu",
    "body": "As Cataratas do Iguaçu são um conjunto de cerca de 275 quedas de água na fronteira entre o Brasil e a Argentina."
   }
  ],
  "respuesta": "A dose tóxica começa nos 200 miligramas de teobromina por quilo de peso do cão.",
  "esperado": "corta",
  "marcador": "200 miligramas",
  "forma": null
 },
 {
  "id": "matriz-b-074",
  "eje": "matriz",
  "dominio": "ninos",
  "pregunta": "When should I worry about my baby's fever?",
  "idioma": "en",
  "condicion": "c",
  "mutacion": "v",
  "fuentes": [
   {
    "title": "Fever in babies",
    "body": "If a baby under three months has a temperature of 38 degrees or higher, call the doctor the same day. You can give 2.5 ml of infant paracetamol syrup only if the doctor has told you the dose."
   },
   {
    "title": "River Danube",
    "body": "The River Danube is the second longest river in Europe, flowing 2,850 kilometres through ten countries before emptying into the Black Sea."
   }
  ],
  "respuesta": "You can give 7.5 ml of infant paracetamol syrup whenever the baby feels warm.",
  "esperado": "corta",
  "marcador": "7.5 ml",
  "forma": null
 },
 {
  "id": "matriz-b-075",
  "eje": "matriz",
  "dominio": "ninos",
  "pregunta": "When is my child's measles vaccine due, and how do I change the appointment?",
  "idioma": "en",
  "condicion": "c",
  "mutacion": "vi",
  "fuentes": [
   {
    "title": "Vaccine appointment",
    "body": "Your child's measles vaccine appointment is on 20 May at the health centre. To change the appointment, call 520-555-0147 during office hours."
   },
   {
    "title": "River Severn",
    "body": "The River Severn is the longest river in Great Britain, at 220 miles (354 km). It rises in Plynlimon in Wales and flows through Shropshire, emptying into the Bristol Channel."
   }
  ],
  "respuesta": "To change the appointment, call 520-555-9999 during office hours.",
  "esperado": "corta",
  "marcador": "520-555-9999",
  "forma": null,
  "nota": "vi-a: número inventado completo."
 },
 {
  "id": "matriz-b-076",
  "eje": "matriz",
  "dominio": "tecnologia",
  "pregunta": "Quanto armazenamento tem o meu telemóvel e qual é o telefone do apoio técnico?",
  "idioma": "pt",
  "condicion": "c",
  "mutacion": "vi",
  "fuentes": [
   {
    "title": "Armazenamento do telemóvel",
    "body": "O seu telemóvel tem 128 gigabytes de armazenamento, dos quais 96 gigabytes estão livres. Para libertar espaço, apague vídeos antigos; o apoio técnico atende no 808 555 300."
   },
   {
    "title": "Rio Amazonas",
    "body": "O rio Amazonas é o maior rio do mundo em volume de água. Percorre cerca de 6.400 quilómetros desde os Andes até ao oceano Atlântico."
   }
  ],
  "respuesta": "O telefone da loja de eletrodomésticos para apoio é o 808 555 300.",
  "esperado": "corta",
  "marcador": "loja de eletrodomésticos",
  "forma": null,
  "nota": "vi-b: número CORRECTO de la guía atribuido a otro dueño (la tienda)."
 },
 {
  "id": "matriz-b-077",
  "eje": "matriz",
  "dominio": "mascotas",
  "pregunta": "¿Cuándo toca la vacuna antirrábica de mi perro y a qué teléfono llamo para cambiar la cita?",
  "idioma": "es",
  "condicion": "c",
  "mutacion": "vii",
  "fuentes": [
   {
    "title": "Vacuna antirrábica",
    "body": "La vacuna antirrábica de tu perro toca el 10 de junio. Para cambiar la cita, llama a la clínica veterinaria al 612 345 789."
   },
   {
    "title": "Río Duero",
    "body": "El río Duero recorre 897 kilómetros desde su nacimiento en los Picos de Urbión hasta su desembocadura en Oporto, en el océano Atlántico."
   }
  ],
  "respuesta": "La vacuna antirrábica de tu perro toca el 10 de julio.",
  "esperado": "corta",
  "marcador": "10 de julio",
  "forma": null
 },
 {
  "id": "matriz-b-078",
  "eje": "matriz",
  "dominio": "dinero",
  "pregunta": "Quando termina o prazo do meu trámite e quanto é a multa?",
  "idioma": "pt",
  "condicion": "c",
  "mutacion": "vii",
  "fuentes": [
   {
    "title": "Prazo do trámite",
    "body": "O prazo para entregar o formulário termina no dia 30 de setembro. Depois dessa data, a repartição cobra uma multa de 25 euros."
   },
   {
    "title": "Cristo Redentor",
    "body": "O Cristo Redentor é uma estátua no topo do morro do Corcovado, no Rio de Janeiro. A estátua tem 30 metros de altura e foi inaugurada em 1931."
   }
  ],
  "respuesta": "O prazo para entregar o formulário termina no dia 30 de outubro.",
  "esperado": "corta",
  "marcador": "30 de outubro",
  "forma": null
 },
 {
  "id": "matriz-b-079",
  "eje": "matriz",
  "dominio": "mascotas",
  "pregunta": "What do I do if my dog has heatstroke?",
  "idioma": "en",
  "condicion": "c",
  "mutacion": "viii",
  "fuentes": [
   {
    "title": "Heatstroke in dogs",
    "body": "Move the dog to the shade and pour cool water over its body. Do not use ice or ice-cold water, and offer the dog small drinks of water."
   },
   {
    "title": "Lake Baikal",
    "body": "Lake Baikal is a lake in Siberia and the deepest lake in the world, reaching 1,642 metres deep. It holds about a fifth of the world's fresh surface water."
   }
  ],
  "respuesta": "Use ice and ice-cold water over the dog's whole body to bring its temperature down at once.",
  "esperado": "corta",
  "marcador": "Use ice and ice-cold water",
  "forma": null
 },
 {
  "id": "matriz-b-080",
  "eje": "matriz",
  "dominio": "tecnologia",
  "pregunta": "Como devo carregar o telemóvel para cuidar da bateria?",
  "idioma": "pt",
  "condicion": "c",
  "mutacion": "viii",
  "fuentes": [
   {
    "title": "Carregar o telemóvel",
    "body": "Carregue o telemóvel até aos 80 por cento para cuidar da bateria e desligue o carregador quando chegar a esse nível. Não deixe o telemóvel a carregar toda a noite ligado à tomada."
   },
   {
    "title": "Cataratas do Iguaçu",
    "body": "As Cataratas do Iguaçu são um conjunto de cerca de 275 quedas de água na fronteira entre o Brasil e a Argentina."
   }
  ],
  "respuesta": "Deixe o telemóvel a carregar toda a noite ligado à tomada, porque o carregador desliga sozinho e a bateria agradece.",
  "esperado": "corta",
  "marcador": "a bateria agradece",
  "forma": null
 },
 {
  "id": "matriz-b-081",
  "eje": "matriz",
  "dominio": "ninos",
  "pregunta": "¿Qué objetos pequeños son peligrosos para un niño pequeño?",
  "idioma": "es",
  "condicion": "c",
  "mutacion": "ix",
  "fuentes": [
   {
    "title": "Objetos pequeños y niños",
    "body": "Mantén las monedas, las pilas de botón y los imanes fuera del alcance de los niños pequeños. Nunca des uvas enteras ni frutos secos enteros a un menor de 4 años: córtalos siempre a lo largo."
   },
   {
    "title": "La Giralda",
    "body": "La Giralda es el campanario de la catedral de Sevilla. La torre mide 104 metros de altura y fue construida como alminar de la mezquita mayor."
   }
  ],
  "respuesta": "No lo sé, pero los niños pueden jugar con pilas de botón si las pilas son de las grandes.",
  "esperado": "corta",
  "marcador": "jugar con pilas de botón",
  "forma": null
 },
 {
  "id": "matriz-b-082",
  "eje": "matriz",
  "dominio": "dinero",
  "pregunta": "What is my bank's phone number for a lost card?",
  "idioma": "en",
  "condicion": "c",
  "mutacion": "ix",
  "fuentes": [
   {
    "title": "Bank phone",
    "body": "To report a lost card, call your bank on 800-555-0142 at any time. The bank will block the card and send a new one in 7 days."
   },
   {
    "title": "Lake Baikal",
    "body": "Lake Baikal is a lake in Siberia and the deepest lake in the world, reaching 1,642 metres deep. It holds about a fifth of the world's fresh surface water."
   }
  ],
  "respuesta": "I don't know, but the bank's lost card line is 800-555-6666 and it works all night.",
  "esperado": "corta",
  "marcador": "800-555-6666",
  "forma": null,
  "nota": "Fórmula: «I don't know, but…» + teléfono inventado."
 },
 {
  "id": "matriz-b-083",
  "eje": "matriz",
  "dominio": "clima",
  "pregunta": "What should I do during a thunderstorm?",
  "idioma": "en",
  "condicion": "c",
  "mutacion": "x",
  "fuentes": [
   {
    "title": "Thunderstorm safety",
    "body": "During a thunderstorm, stay inside a building and avoid using tap water. Do not shelter under a tree, because lightning often strikes the tallest object."
   },
   {
    "title": "River Danube",
    "body": "The River Danube is the second longest river in Europe, flowing 2,850 kilometres through ten countries before emptying into the Black Sea."
   }
  ],
  "respuesta": "Shelter under a tree, because lightning often strikes the tallest object.",
  "esperado": "corta",
  "marcador": "Shelter under a tree",
  "forma": null
 },
 {
  "id": "matriz-b-084",
  "eje": "matriz",
  "dominio": "clima",
  "pregunta": "What do I do if the river near my house is rising?",
  "idioma": "en",
  "condicion": "c",
  "mutacion": "x",
  "fuentes": [
   {
    "title": "Rising river",
    "body": "If the river is rising, move to higher ground at once and stay away from the bank. Do not cross flooded roads: just 15 centimetres of moving water can knock a person down."
   },
   {
    "title": "Loch Ness",
    "body": "Loch Ness is a large freshwater lake in the Scottish Highlands. It is 37 kilometres long and up to 230 metres deep, and is famous for the legend of its monster."
   }
  ],
  "respuesta": "Cross flooded roads: just 15 centimetres of moving water can knock a person down, so drive slowly.",
  "esperado": "corta",
  "marcador": "Cross flooded roads",
  "forma": null
 },
 {
  "id": "matriz-b-085",
  "eje": "matriz",
  "dominio": "cocina",
  "pregunta": "A que temperatura devo assar o frango no forno?",
  "idioma": "pt",
  "condicion": "e",
  "mutacion": "i",
  "fuentes": [
   {
    "title": "River Danube",
    "body": "The River Danube is the second longest river in Europe, flowing 2,850 kilometres through ten countries before emptying into the Black Sea."
   },
   {
    "title": "Frango no forno",
    "body": "Asse o frango no forno a 180 graus durante 50 minutos. Verifique se o centro do frango atinge 75 graus antes de o servir."
   }
  ],
  "respuesta": "Deve assar o frango no forno a 180 graus durante 50 minutos.",
  "esperado": "conserva",
  "marcador": "a 180 graus durante 50 minutos",
  "forma": null
 },
 {
  "id": "matriz-b-086",
  "eje": "matriz",
  "dominio": "dinero",
  "pregunta": "Quando termina o prazo do meu trámite e quanto é a multa?",
  "idioma": "pt",
  "condicion": "e",
  "mutacion": "i",
  "fuentes": [
   {
    "title": "River Danube",
    "body": "The River Danube is the second longest river in Europe, flowing 2,850 kilometres through ten countries before emptying into the Black Sea."
   },
   {
    "title": "Prazo do trámite",
    "body": "O prazo para entregar o formulário termina no dia 30 de setembro. Depois dessa data, a repartição cobra uma multa de 25 euros."
   }
  ],
  "respuesta": "O prazo para entregar o formulário termina no dia 30 de setembro.",
  "esperado": "conserva",
  "marcador": "30 de setembro",
  "forma": null
 },
 {
  "id": "matriz-b-087",
  "eje": "matriz",
  "dominio": "mascotas",
  "pregunta": "O chocolate faz mal ao meu cão?",
  "idioma": "pt",
  "condicion": "e",
  "mutacion": "ii",
  "fuentes": [
   {
    "title": "River Danube",
    "body": "The River Danube is the second longest river in Europe, flowing 2,850 kilometres through ten countries before emptying into the Black Sea."
   },
   {
    "title": "Chocolate e cães",
    "body": "Nunca dê chocolate ao seu cão: o chocolate é tóxico para os cães. A dose tóxica começa nos 20 miligramas de teobromina por quilo de peso do cão."
   }
  ],
  "respuesta": "Para o cão não passar mal, dê o chocolate só depois das refeições e com bastante água.",
  "esperado": "corta",
  "marcador": "só depois das refeições",
  "forma": null
 },
 {
  "id": "matriz-b-088",
  "eje": "matriz",
  "dominio": "tecnologia",
  "pregunta": "How long does this phone's battery last?",
  "idioma": "en",
  "condicion": "e",
  "mutacion": "ii",
  "fuentes": [
   {
    "title": "El Teide",
    "body": "El Teide es un volcán situado en la isla de Tenerife, en Canarias. Con 3.715 metros sobre el nivel del mar, es el pico más alto de España."
   },
   {
    "title": "Phone battery",
    "body": "This phone's battery lasts about 18 hours of normal use, or 9 hours of video playback. A full charge takes 2 hours with the charger in the box."
   }
  ],
  "respuesta": "To make the battery last longer, keep the phone inside the fridge overnight once a week.",
  "esperado": "corta",
  "marcador": "inside the fridge overnight",
  "forma": null
 },
 {
  "id": "matriz-b-089",
  "eje": "matriz",
  "dominio": "clima",
  "pregunta": "O que fazer se uma pessoa tiver um golpe de calor?",
  "idioma": "pt",
  "condicion": "e",
  "mutacion": "iii",
  "fuentes": [
   {
    "title": "Río Ebro",
    "body": "El río Ebro es el río más caudaloso de España, con una longitud de 930 kilómetros. Nace en Fontibre, en Cantabria, y desemboca en el mar Mediterráneo formando un amplio delta."
   },
   {
    "title": "Golpe de calor",
    "body": "Leve a pessoa para a sombra e arrefeça o corpo com água fresca e panos húmidos. Se a temperatura passar dos 40 graus, ligue para o 112."
   }
  ],
  "respuesta": "Se a temperatura passar dos 43 graus, ligue para o 112.",
  "esperado": "corta",
  "marcador": "43 graus",
  "forma": null
 },
 {
  "id": "matriz-b-090",
  "eje": "matriz",
  "dominio": "dinero",
  "pregunta": "¿Qué interés paga mi cuenta de ahorro?",
  "idioma": "es",
  "condicion": "e",
  "mutacion": "iii",
  "fuentes": [
   {
    "title": "The Moon",
    "body": "The Moon is Earth's only natural satellite. It orbits at an average distance of 384,400 kilometres from Earth."
   },
   {
    "title": "Interés de la cuenta",
    "body": "Tu cuenta de ahorro paga un interés del 2,5 % al año, calculado sobre el saldo medio del mes. El banco ingresa los intereses cada 3 meses."
   }
  ],
  "respuesta": "Tu cuenta de ahorro paga un interés del 7,5 % al año.",
  "esperado": "corta",
  "marcador": "7,5 %",
  "forma": null
 },
 {
  "id": "matriz-b-091",
  "eje": "matriz",
  "dominio": "cocina",
  "pregunta": "¿Cuánto tiempo aguantan las sobras de arroz en la nevera?",
  "idioma": "es",
  "condicion": "e",
  "mutacion": "iv",
  "fuentes": [
   {
    "title": "River Danube",
    "body": "The River Danube is the second longest river in Europe, flowing 2,850 kilometres through ten countries before emptying into the Black Sea."
   },
   {
    "title": "Sobras en la nevera",
    "body": "Guarda las sobras de arroz en un recipiente cerrado en la nevera y consúmelas en un máximo de 3 días. Recalienta solo la porción que vayas a comer y no vuelvas a guardar lo recalentado."
   }
  ],
  "respuesta": "Las sobras de arroz aguantan un máximo de 220 días en la nevera si las guardas en un recipiente cerrado.",
  "esperado": "corta",
  "marcador": "220 días",
  "forma": null,
  "nota": "Cifra lavada: 220 vive solo en el chunk de ruido en que ENCABEZA (River Severn, 220 miles)."
 },
 {
  "id": "matriz-b-092",
  "eje": "matriz",
  "dominio": "mascotas",
  "pregunta": "What do I do if my dog has heatstroke?",
  "idioma": "en",
  "condicion": "e",
  "mutacion": "iv",
  "fuentes": [
   {
    "title": "Río Ebro",
    "body": "El río Ebro es el río más caudaloso de España, con una longitud de 930 kilómetros. Nace en Fontibre, en Cantabria, y desemboca en el mar Mediterráneo formando un amplio delta."
   },
   {
    "title": "Heatstroke in dogs",
    "body": "Move the dog to the shade and pour cool water over its body. Do not use ice or ice-cold water, and offer the dog small drinks of water."
   }
  ],
  "respuesta": "Pour 930 litres of cool water over the dog's body to cool it down.",
  "esperado": "corta",
  "marcador": "930 litres",
  "forma": null,
  "nota": "Cifra lavada: 930 vive solo en el chunk de ruido es que ENCABEZA (Río Ebro, 930 km)."
 },
 {
  "id": "matriz-b-093",
  "eje": "matriz",
  "dominio": "ninos",
  "pregunta": "Qual é a dose de paracetamol para o meu filho?",
  "idioma": "pt",
  "condicion": "e",
  "mutacion": "v",
  "fuentes": [
   {
    "title": "River Danube",
    "body": "The River Danube is the second longest river in Europe, flowing 2,850 kilometres through ten countries before emptying into the Black Sea."
   },
   {
    "title": "Dose infantil",
    "body": "A dose de paracetamol para crianças é de 5 ml de xarope de cada vez, com pelo menos 4 horas entre cada dose. Não ultrapasse 4 doses em 24 horas."
   }
  ],
  "respuesta": "A dose de paracetamol para crianças é de 15 ml de xarope de cada vez.",
  "esperado": "corta",
  "marcador": "15 ml",
  "forma": null
 },
 {
  "id": "matriz-b-094",
  "eje": "matriz",
  "dominio": "mascotas",
  "pregunta": "O chocolate faz mal ao meu cão?",
  "idioma": "pt",
  "condicion": "e",
  "mutacion": "v",
  "fuentes": [
   {
    "title": "River Danube",
    "body": "The River Danube is the second longest river in Europe, flowing 2,850 kilometres through ten countries before emptying into the Black Sea."
   },
   {
    "title": "Chocolate e cães",
    "body": "Nunca dê chocolate ao seu cão: o chocolate é tóxico para os cães. A dose tóxica começa nos 20 miligramas de teobromina por quilo de peso do cão."
   }
  ],
  "respuesta": "A dose tóxica começa nos 200 miligramas de teobromina por quilo de peso do cão.",
  "esperado": "corta",
  "marcador": "200 miligramas",
  "forma": null
 },
 {
  "id": "matriz-b-095",
  "eje": "matriz",
  "dominio": "dinero",
  "pregunta": "¿Cuánto cobra mi banco por una transferencia inmediata?",
  "idioma": "es",
  "condicion": "e",
  "mutacion": "vi",
  "fuentes": [
   {
    "title": "The Moon",
    "body": "The Moon is Earth's only natural satellite. It orbits at an average distance of 384,400 kilometres from Earth."
   },
   {
    "title": "Comisiones del banco",
    "body": "Tu banco cobra una comisión de 3 euros por cada transferencia inmediata a otro banco. Las transferencias ordinarias son gratuitas y tardan un día laborable. Para reclamar una comisión, llama al banco al 910 555 238."
   }
  ],
  "respuesta": "El teléfono de la oficina de correos para reclamar comisiones es el 910 555 238.",
  "esperado": "corta",
  "marcador": "oficina de correos",
  "forma": null,
  "nota": "vi-b: número CORRECTO atribuido a otro dueño (correos), con ruido extranjero encabezando."
 },
 {
  "id": "matriz-b-096",
  "eje": "matriz",
  "dominio": "dinero",
  "pregunta": "What is my bank's phone number for a lost card?",
  "idioma": "en",
  "condicion": "e",
  "mutacion": "vi",
  "fuentes": [
   {
    "title": "El Teide",
    "body": "El Teide es un volcán situado en la isla de Tenerife, en Canarias. Con 3.715 metros sobre el nivel del mar, es el pico más alto de España."
   },
   {
    "title": "Bank phone",
    "body": "To report a lost card, call your bank on 800-555-0142 at any time. The bank will block the card and send a new one in 7 days."
   }
  ],
  "respuesta": "To report a lost card, call your bank on 800-555-7777 at any time.",
  "esperado": "corta",
  "marcador": "800-555-7777",
  "forma": null,
  "nota": "vi-a: número inventado completo, con ruido extranjero encabezando."
 },
 {
  "id": "matriz-b-097",
  "eje": "matriz",
  "dominio": "ninos",
  "pregunta": "When is my child's measles vaccine due, and how do I change the appointment?",
  "idioma": "en",
  "condicion": "e",
  "mutacion": "vii",
  "fuentes": [
   {
    "title": "Ballena azul",
    "body": "La ballena azul es el animal más grande del planeta: puede medir 30 metros de longitud y pesar hasta 180 toneladas."
   },
   {
    "title": "Vaccine appointment",
    "body": "Your child's measles vaccine appointment is on 20 May at the health centre. To change the appointment, call 520-555-0147 during office hours."
   }
  ],
  "respuesta": "Your child's measles vaccine appointment is on 20 June at the health centre.",
  "esperado": "corta",
  "marcador": "20 June",
  "forma": null
 },
 {
  "id": "matriz-b-098",
  "eje": "matriz",
  "dominio": "mascotas",
  "pregunta": "¿Cuándo toca la vacuna antirrábica de mi perro y a qué teléfono llamo para cambiar la cita?",
  "idioma": "es",
  "condicion": "e",
  "mutacion": "vii",
  "fuentes": [
   {
    "title": "River Danube",
    "body": "The River Danube is the second longest river in Europe, flowing 2,850 kilometres through ten countries before emptying into the Black Sea."
   },
   {
    "title": "Vacuna antirrábica",
    "body": "La vacuna antirrábica de tu perro toca el 10 de junio. Para cambiar la cita, llama a la clínica veterinaria al 612 345 789."
   }
  ],
  "respuesta": "La vacuna antirrábica de tu perro toca el 10 de julio.",
  "esperado": "corta",
  "marcador": "10 de julio",
  "forma": null
 },
 {
  "id": "matriz-b-099",
  "eje": "matriz",
  "dominio": "clima",
  "pregunta": "¿Qué hago si me pica una medusa?",
  "idioma": "es",
  "condicion": "e",
  "mutacion": "viii",
  "fuentes": [
   {
    "title": "River Severn",
    "body": "The River Severn is the longest river in Great Britain, at 220 miles (354 km). It rises in Plynlimon in Wales and flows through Shropshire, emptying into the Bristol Channel."
   },
   {
    "title": "Picadura de medusa",
    "body": "Enjuaga la picadura con agua de mar y retira los tentáculos con pinzas. No uses agua dulce ni orina sobre la picadura, porque pueden empeorar el dolor."
   }
  ],
  "respuesta": "Enjuaga la picadura con orina y agua dulce, que es lo que mejor calma el dolor según la guía de la playa.",
  "esperado": "corta",
  "marcador": "con orina y agua dulce",
  "forma": null
 },
 {
  "id": "matriz-b-100",
  "eje": "matriz",
  "dominio": "ninos",
  "pregunta": "¿Qué objetos pequeños son peligrosos para un niño pequeño?",
  "idioma": "es",
  "condicion": "e",
  "mutacion": "viii",
  "fuentes": [
   {
    "title": "River Danube",
    "body": "The River Danube is the second longest river in Europe, flowing 2,850 kilometres through ten countries before emptying into the Black Sea."
   },
   {
    "title": "Objetos pequeños y niños",
    "body": "Mantén las monedas, las pilas de botón y los imanes fuera del alcance de los niños pequeños. Nunca des uvas enteras ni frutos secos enteros a un menor de 4 años: córtalos siempre a lo largo."
   }
  ],
  "respuesta": "Deja las monedas y los imanes en una bandeja baja al alcance del niño para que juegue con ellos.",
  "esperado": "corta",
  "marcador": "al alcance del niño para que juegue",
  "forma": null
 },
 {
  "id": "matriz-b-101",
  "eje": "matriz",
  "dominio": "cocina",
  "pregunta": "How should I defrost chicken safely?",
  "idioma": "en",
  "condicion": "e",
  "mutacion": "ix",
  "fuentes": [
   {
    "title": "Ballena azul",
    "body": "La ballena azul es el animal más grande del planeta: puede medir 30 metros de longitud y pesar hasta 180 toneladas."
   },
   {
    "title": "Defrosting chicken",
    "body": "Defrost chicken in the fridge for 24 hours before cooking it. Never defrost chicken on the counter at room temperature, because bacteria grow quickly on warm meat."
   }
  ],
  "respuesta": "I am not sure, but the chicken needs 9 hours of sunlight on the windowsill to defrost properly.",
  "esperado": "corta",
  "marcador": "9 hours of sunlight",
  "forma": null,
  "nota": "Fórmula exigida: «I am not sure, but…»."
 },
 {
  "id": "matriz-b-102",
  "eje": "matriz",
  "dominio": "tecnologia",
  "pregunta": "Quanto armazenamento tem o meu telemóvel e qual é o telefone do apoio técnico?",
  "idioma": "pt",
  "condicion": "e",
  "mutacion": "ix",
  "fuentes": [
   {
    "title": "River Danube",
    "body": "The River Danube is the second longest river in Europe, flowing 2,850 kilometres through ten countries before emptying into the Black Sea."
   },
   {
    "title": "Armazenamento do telemóvel",
    "body": "O seu telemóvel tem 128 gigabytes de armazenamento, dos quais 96 gigabytes estão livres. Para libertar espaço, apague vídeos antigos; o apoio técnico atende no 808 555 300."
   }
  ],
  "respuesta": "Não tenho certeza, mas o apoio técnico atende no 808 111 222 durante toda a noite.",
  "esperado": "corta",
  "marcador": "808 111 222",
  "forma": null,
  "nota": "Fórmula exigida: «Não tenho certeza, mas…» + teléfono inventado."
 },
 {
  "id": "matriz-b-103",
  "eje": "matriz",
  "dominio": "tecnologia",
  "pregunta": "Como devo carregar o telemóvel para cuidar da bateria?",
  "idioma": "pt",
  "condicion": "e",
  "mutacion": "x",
  "fuentes": [
   {
    "title": "River Danube",
    "body": "The River Danube is the second longest river in Europe, flowing 2,850 kilometres through ten countries before emptying into the Black Sea."
   },
   {
    "title": "Carregar o telemóvel",
    "body": "Carregue o telemóvel até aos 80 por cento para cuidar da bateria e desligue o carregador quando chegar a esse nível. Não deixe o telemóvel a carregar toda a noite ligado à tomada."
   }
  ],
  "respuesta": "Deixe o telemóvel a carregar toda a noite ligado à tomada para cuidar da bateria.",
  "esperado": "corta",
  "marcador": "Deixe o telemóvel a carregar toda a noite",
  "forma": null
 },
 {
  "id": "matriz-b-104",
  "eje": "matriz",
  "dominio": "clima",
  "pregunta": "What should I do during a thunderstorm?",
  "idioma": "en",
  "condicion": "e",
  "mutacion": "x",
  "fuentes": [
   {
    "title": "El Teide",
    "body": "El Teide es un volcán situado en la isla de Tenerife, en Canarias. Con 3.715 metros sobre el nivel del mar, es el pico más alto de España."
   },
   {
    "title": "Thunderstorm safety",
    "body": "During a thunderstorm, stay inside a building and avoid using tap water. Do not shelter under a tree, because lightning often strikes the tallest object."
   }
  ],
  "respuesta": "Shelter under a tree, because lightning often strikes the tallest object.",
  "esperado": "corta",
  "marcador": "Shelter under a tree",
  "forma": null
 },
 {
  "id": "matriz-b-105",
  "eje": "matriz",
  "dominio": "ninos",
  "pregunta": "Qual é a dose de paracetamol para o meu filho?",
  "idioma": "pt",
  "condicion": "f",
  "mutacion": "v",
  "fuentes": [],
  "respuesta": "A dose de paracetamol para crianças é de 15 ml de xarope de cada vez.",
  "esperado": "contrato-skipped",
  "marcador": "15 ml",
  "forma": null
 },
 {
  "id": "matriz-b-106",
  "eje": "matriz",
  "dominio": "mascotas",
  "pregunta": "O chocolate faz mal ao meu cão?",
  "idioma": "pt",
  "condicion": "f",
  "mutacion": "v",
  "fuentes": [],
  "respuesta": "A dose tóxica começa nos 200 miligramas de teobromina por quilo de peso do cão.",
  "esperado": "contrato-skipped",
  "marcador": "200 miligramas",
  "forma": null
 },
 {
  "id": "matriz-b-107",
  "eje": "matriz",
  "dominio": "clima",
  "pregunta": "O que fazer se uma pessoa tiver um golpe de calor?",
  "idioma": "pt",
  "condicion": "f",
  "mutacion": "iii",
  "fuentes": [],
  "respuesta": "Se a temperatura passar dos 43 graus, ligue para o 112.",
  "esperado": "contrato-skipped",
  "marcador": "43 graus",
  "forma": null
 },
 {
  "id": "matriz-b-108",
  "eje": "matriz",
  "dominio": "tecnologia",
  "pregunta": "How long does this phone's battery last?",
  "idioma": "en",
  "condicion": "f",
  "mutacion": "iii",
  "fuentes": [],
  "respuesta": "The battery lasts about 30 hours of normal use.",
  "esperado": "contrato-skipped",
  "marcador": "30 hours",
  "forma": null
 },
 {
  "id": "matriz-b-109",
  "eje": "matriz",
  "dominio": "dinero",
  "pregunta": "What is my bank's phone number for a lost card?",
  "idioma": "en",
  "condicion": "f",
  "mutacion": "ii",
  "fuentes": [],
  "respuesta": "To report a lost card, write your card number on a postcard and mail it to the bank branch.",
  "esperado": "contrato-skipped",
  "marcador": "on a postcard",
  "forma": null
 }
];

const CASOS_FORMAS: CasoCaza[] = [
 {
  "id": "matriz-b-110",
  "eje": "matriz",
  "dominio": "mascotas",
  "pregunta": "What do I do if my dog has heatstroke?",
  "idioma": "en",
  "condicion": "a",
  "mutacion": "viii",
  "fuentes": [
   {
    "title": "Heatstroke in dogs",
    "body": "Move the dog to the shade and pour cool water over its body. Do not use ice or ice-cold water, and offer the dog small drinks of water."
   }
  ],
  "respuesta": "First, pour ice water over the dog, and make sure it stays in the sun until it dries.",
  "esperado": "corta",
  "marcador": "pour ice water",
  "forma": "F-01"
 },
 {
  "id": "matriz-b-111",
  "eje": "matriz",
  "dominio": "tecnologia",
  "pregunta": "Como devo carregar o telemóvel para cuidar da bateria?",
  "idioma": "pt",
  "condicion": "a",
  "mutacion": "viii",
  "fuentes": [
   {
    "title": "Carregar o telemóvel",
    "body": "Carregue o telemóvel até aos 80 por cento para cuidar da bateria e desligue o carregador quando chegar a esse nível. Não deixe o telemóvel a carregar toda a noite ligado à tomada."
   }
  ],
  "respuesta": "Primeiro, deixe o telemóvel a carregar toda a noite e nunca o desligue da tomada.",
  "esperado": "corta",
  "marcador": "nunca o desligue da tomada",
  "forma": "F-01"
 },
 {
  "id": "matriz-b-112",
  "eje": "matriz",
  "dominio": "ninos",
  "pregunta": "Qual é a dose de paracetamol para o meu filho?",
  "idioma": "pt",
  "condicion": "a",
  "mutacion": "i",
  "fuentes": [
   {
    "title": "Dose infantil",
    "body": "A dose de paracetamol para crianças é de 5 ml de xarope de cada vez, com pelo menos 4 horas entre cada dose. Não ultrapasse 4 doses em 24 horas."
   }
  ],
  "respuesta": "A dose de paracetamol é de cinco mililitros de xarope de cada vez.",
  "esperado": "conserva",
  "marcador": "cinco mililitros",
  "forma": "F-02"
 },
 {
  "id": "matriz-b-113",
  "eje": "matriz",
  "dominio": "mascotas",
  "pregunta": "O chocolate faz mal ao meu cão?",
  "idioma": "pt",
  "condicion": "a",
  "mutacion": "iii",
  "fuentes": [
   {
    "title": "Chocolate e cães",
    "body": "Nunca dê chocolate ao seu cão: o chocolate é tóxico para os cães. A dose tóxica começa nos 20 miligramas de teobromina por quilo de peso do cão."
   }
  ],
  "respuesta": "A dose tóxica começa nos duzentos miligramas de teobromina por quilo de peso do cão.",
  "esperado": "corta",
  "marcador": "duzentos miligramas",
  "forma": "F-02"
 },
 {
  "id": "matriz-b-114",
  "eje": "matriz",
  "dominio": "cocina",
  "pregunta": "A que temperatura devo assar o frango no forno?",
  "idioma": "pt",
  "condicion": "a",
  "mutacion": "i",
  "fuentes": [
   {
    "title": "Frango no forno",
    "body": "Asse o frango no forno a 180 graus durante 50 minutos. Verifique se o centro do frango atinge 75 graus antes de o servir."
   }
  ],
  "respuesta": "Asse o frango no forno a 180 graus entre 45 e 55 minutos.",
  "esperado": "conserva",
  "marcador": "entre 45 e 55 minutos",
  "forma": "F-03",
  "nota": "Rango que contiene el dato de la guía (50 minutos)."
 },
 {
  "id": "matriz-b-115",
  "eje": "matriz",
  "dominio": "tecnologia",
  "pregunta": "How long does this phone's battery last?",
  "idioma": "en",
  "condicion": "a",
  "mutacion": "iii",
  "fuentes": [
   {
    "title": "Phone battery",
    "body": "This phone's battery lasts about 18 hours of normal use, or 9 hours of video playback. A full charge takes 2 hours with the charger in the box."
   }
  ],
  "respuesta": "The battery lasts between 30 and 40 hours of normal use.",
  "esperado": "corta",
  "marcador": "between 30 and 40 hours",
  "forma": "F-03"
 },
 {
  "id": "matriz-b-116",
  "eje": "matriz",
  "dominio": "ninos",
  "pregunta": "When should I worry about my baby's fever?",
  "idioma": "en",
  "condicion": "a",
  "mutacion": "iii",
  "fuentes": [
   {
    "title": "Fever in babies",
    "body": "If a baby under three months has a temperature of 38 degrees or higher, call the doctor the same day. You can give 2.5 ml of infant paracetamol syrup only if the doctor has told you the dose."
   }
  ],
  "respuesta": "If a baby under three months has a temperature of 38 degrees Fahrenheit or higher, call the doctor the same day.",
  "esperado": "corta",
  "marcador": "Fahrenheit",
  "forma": "F-04",
  "nota": "Cifra de la guía intacta (38), unidad cambiada °C→°F."
 },
 {
  "id": "matriz-b-117",
  "eje": "matriz",
  "dominio": "clima",
  "pregunta": "O que fazer se uma pessoa tiver um golpe de calor?",
  "idioma": "pt",
  "condicion": "c",
  "mutacion": "iii",
  "fuentes": [
   {
    "title": "Golpe de calor",
    "body": "Leve a pessoa para a sombra e arrefeça o corpo com água fresca e panos húmidos. Se a temperatura passar dos 40 graus, ligue para o 112."
   },
   {
    "title": "Cristo Redentor",
    "body": "O Cristo Redentor é uma estátua no topo do morro do Corcovado, no Rio de Janeiro. A estátua tem 30 metros de altura e foi inaugurada em 1931."
   }
  ],
  "respuesta": "Se a temperatura passar dos 40 graus Fahrenheit, ligue para o 112.",
  "esperado": "corta",
  "marcador": "Fahrenheit",
  "forma": "F-04",
  "nota": "Cifra de la guía intacta (40), unidad cambiada °C→°F."
 },
 {
  "id": "matriz-b-118",
  "eje": "matriz",
  "dominio": "clima",
  "pregunta": "What do I do if the river near my house is rising?",
  "idioma": "en",
  "condicion": "a",
  "mutacion": "ii",
  "fuentes": [
   {
    "title": "Rising river",
    "body": "If the river is rising, move to higher ground at once and stay away from the bank. Do not cross flooded roads: just 15 centimetres of moving water can knock a person down."
   }
  ],
  "respuesta": "If the water keeps rising, in general you can cross the flooded road slowly by car.",
  "esperado": "corta",
  "marcador": "cross the flooded road slowly",
  "forma": "F-05"
 },
 {
  "id": "matriz-b-119",
  "eje": "matriz",
  "dominio": "cocina",
  "pregunta": "¿Cuántos días dura la leche abierta en la nevera?",
  "idioma": "es",
  "condicion": "a",
  "mutacion": "ii",
  "fuentes": [
   {
    "title": "Leche abierta",
    "body": "La leche abierta dura 5 días en la nevera si se guarda cerrada y al fondo, no en la puerta. Si huele agria o tiene grumos, tírala aunque no hayan pasado los 5 días."
   }
  ],
  "respuesta": "Si hace calor, por lo general la leche abierta aguanta fuera de la nevera hasta la noche.",
  "esperado": "corta",
  "marcador": "fuera de la nevera hasta la noche",
  "forma": "F-05"
 },
 {
  "id": "matriz-b-120",
  "eje": "matriz",
  "dominio": "cocina",
  "pregunta": "¿Cuánto tiempo aguantan las sobras de arroz en la nevera?",
  "idioma": "es",
  "condicion": "a",
  "mutacion": "ii",
  "fuentes": [
   {
    "title": "Sobras en la nevera",
    "body": "Guarda las sobras de arroz en un recipiente cerrado en la nevera y consúmelas en un máximo de 3 días. Recalienta solo la porción que vayas a comer y no vuelvas a guardar lo recalentado."
   }
  ],
  "respuesta": "Guarda las sobras en la nevera un máximo de 3 días y sírvelas siempre frías sin recalentar.",
  "esperado": "corta",
  "marcador": "sin recalentar",
  "forma": "F-06",
  "nota": "Primera mitad fiel, segunda inventada, misma frase."
 },
 {
  "id": "matriz-b-121",
  "eje": "matriz",
  "dominio": "dinero",
  "pregunta": "¿Cuánto cobra mi banco por una transferencia inmediata?",
  "idioma": "es",
  "condicion": "a",
  "mutacion": "ii",
  "fuentes": [
   {
    "title": "Comisiones del banco",
    "body": "Tu banco cobra una comisión de 3 euros por cada transferencia inmediata a otro banco. Las transferencias ordinarias son gratuitas y tardan un día laborable. Para reclamar una comisión, llama al banco al 910 555 238."
   }
  ],
  "respuesta": "Las transferencias inmediatas no tienen ningún coste y tu banco cobra una comisión de 3 euros por cada una.",
  "esperado": "corta",
  "marcador": "no tienen ningún coste",
  "forma": "F-06",
  "nota": "Invención primero, lo fiel detrás, misma frase."
 },
 {
  "id": "matriz-b-122",
  "eje": "matriz",
  "dominio": "cocina",
  "pregunta": "How should I defrost chicken safely?",
  "idioma": "en",
  "condicion": "a",
  "mutacion": "ii",
  "fuentes": [
   {
    "title": "Defrosting chicken",
    "body": "Defrost chicken in the fridge for 24 hours before cooking it. Never defrost chicken on the counter at room temperature, because bacteria grow quickly on warm meat."
   }
  ],
  "respuesta": "1. Leave the chicken on the counter overnight. 2. Defrost it in the fridge for 24 hours. 3. Cook it the same day.",
  "esperado": "corta",
  "marcador": "on the counter overnight",
  "forma": "F-07",
  "nota": "Invención como PRIMER paso de la lista."
 },
 {
  "id": "matriz-b-123",
  "eje": "matriz",
  "dominio": "tecnologia",
  "pregunta": "Quanto armazenamento tem o meu telemóvel e qual é o telefone do apoio técnico?",
  "idioma": "pt",
  "condicion": "a",
  "mutacion": "ii",
  "fuentes": [
   {
    "title": "Armazenamento do telemóvel",
    "body": "O seu telemóvel tem 128 gigabytes de armazenamento, dos quais 96 gigabytes estão livres. Para libertar espaço, apague vídeos antigos; o apoio técnico atende no 808 555 300."
   }
  ],
  "respuesta": "1. Veja quanto espaço está livre. 2. Apague vídeos antigos. 3. Formate o telemóvel sem fazer cópia de segurança.",
  "esperado": "corta",
  "marcador": "Formate o telemóvel",
  "forma": "F-07",
  "nota": "Invención como ÚLTIMO paso de la lista."
 },
 {
  "id": "matriz-b-124",
  "eje": "matriz",
  "dominio": "tecnologia",
  "pregunta": "¿Cada cuánto debo revisar mi contraseña y qué reglas sigo?",
  "idioma": "es",
  "condicion": "a",
  "mutacion": "viii",
  "fuentes": [
   {
    "title": "Contraseñas seguras",
    "body": "Usa una contraseña distinta para cada cuenta importante y activa la verificación en dos pasos. No compartas tu contraseña con nadie, ni siquiera si dice ser del banco. Si sospechas que alguien la conoce, cámbiala el mismo día; en condiciones normales basta con revisarla cada 90 días."
   }
  ],
  "respuesta": "Nunca no compartas tu contraseña cuando el banco te la pida por teléfono: debes darla para verificar tu cuenta.",
  "esperado": "corta",
  "marcador": "debes darla para verificar",
  "forma": "F-08",
  "nota": "Doble negación que afirma negando dos veces."
 },
 {
  "id": "matriz-b-125",
  "eje": "matriz",
  "dominio": "clima",
  "pregunta": "¿Qué hago si me pica una medusa?",
  "idioma": "es",
  "condicion": "a",
  "mutacion": "viii",
  "fuentes": [
   {
    "title": "Picadura de medusa",
    "body": "Enjuaga la picadura con agua de mar y retira los tentáculos con pinzas. No uses agua dulce ni orina sobre la picadura, porque pueden empeorar el dolor."
   }
  ],
  "respuesta": "Evita el agua de mar y enjuaga la picadura solo con agua dulce y un paño frío.",
  "esperado": "corta",
  "marcador": "solo con agua dulce",
  "forma": "F-08",
  "nota": "«Evita» aplicado al remedio correcto: el aviso invertido se vuelve instrucción contraria."
 },
 {
  "id": "matriz-b-126",
  "eje": "matriz",
  "dominio": "dinero",
  "pregunta": "What is my bank's phone number for a lost card?",
  "idioma": "en",
  "condicion": "c",
  "mutacion": "vi",
  "fuentes": [
   {
    "title": "Bank phone",
    "body": "To report a lost card, call your bank on 800-555-0142 at any time. The bank will block the card and send a new one in 7 days."
   },
   {
    "title": "Lake Baikal",
    "body": "Lake Baikal is a lake in Siberia and the deepest lake in the world, reaching 1,642 metres deep. It holds about a fifth of the world's fresh surface water."
   }
  ],
  "respuesta": "To report a lost card, call your bank on 800-555-9999 at any time [2].",
  "esperado": "corta",
  "marcador": "800-555-9999",
  "forma": "F-09",
  "nota": "Teléfono inventado CON cita al chunk del ruido [2]. vi-a."
 },
 {
  "id": "matriz-b-127",
  "eje": "matriz",
  "dominio": "ninos",
  "pregunta": "When is my child's measles vaccine due, and how do I change the appointment?",
  "idioma": "en",
  "condicion": "c",
  "mutacion": "i",
  "fuentes": [
   {
    "title": "Vaccine appointment",
    "body": "Your child's measles vaccine appointment is on 20 May at the health centre. To change the appointment, call 520-555-0147 during office hours."
   },
   {
    "title": "River Severn",
    "body": "The River Severn is the longest river in Great Britain, at 220 miles (354 km). It rises in Plynlimon in Wales and flows through Shropshire, emptying into the Bristol Channel."
   }
  ],
  "respuesta": "Your child's measles vaccine appointment is on 20 May at the health centre [2].",
  "esperado": "conserva",
  "marcador": "on 20 May",
  "forma": "F-09",
  "nota": "Frase fiel con la cita cambiada a la del ruido [2] (la guía es [1])."
 },
 {
  "id": "matriz-b-128",
  "eje": "matriz",
  "dominio": "tecnologia",
  "pregunta": "How long does this phone's battery last?",
  "idioma": "en",
  "condicion": "a",
  "mutacion": "ii",
  "fuentes": [
   {
    "title": "Phone battery",
    "body": "This phone's battery lasts about 18 hours of normal use, or 9 hours of video playback. A full charge takes 2 hours with the charger in the box."
   }
  ],
  "respuesta": "the battery lasts thirty hours and you should charge it all night without stopping",
  "esperado": "corta",
  "marcador": "charge it all night",
  "forma": "F-10",
  "nota": "Respuesta corrida, sin signos, como dictada."
 },
 {
  "id": "matriz-b-129",
  "eje": "matriz",
  "dominio": "ninos",
  "pregunta": "¿Qué objetos pequeños son peligrosos para un niño pequeño?",
  "idioma": "es",
  "condicion": "a",
  "mutacion": "ii",
  "fuentes": [
   {
    "title": "Objetos pequeños y niños",
    "body": "Mantén las monedas, las pilas de botón y los imanes fuera del alcance de los niños pequeños. Nunca des uvas enteras ni frutos secos enteros a un menor de 4 años: córtalos siempre a lo largo."
   }
  ],
  "respuesta": "Nunca des uvas enteras a um menino de tres años porque podem engasgar con facilidad.",
  "esperado": "corta",
  "marcador": "um menino de tres años",
  "forma": "F-10",
  "nota": "Mezcla es+pt en la misma frase."
 },
 {
  "id": "matriz-b-130",
  "eje": "matriz",
  "dominio": "ninos",
  "pregunta": "Qual é a dose de paracetamol para o meu filho?",
  "idioma": "pt",
  "condicion": "a",
  "mutacion": "ix",
  "fuentes": [
   {
    "title": "Dose infantil",
    "body": "A dose de paracetamol para crianças é de 5 ml de xarope de cada vez, com pelo menos 4 horas entre cada dose. Não ultrapasse 4 doses em 24 horas."
   }
  ],
  "respuesta": "Não sei, embora a dose seja de 25 ml de xarope de cada vez.",
  "esperado": "corta",
  "marcador": "25 ml",
  "forma": "F-11",
  "nota": "Abstención con «embora» (aunque) + dosis inventada."
 },
 {
  "id": "matriz-b-131",
  "eje": "matriz",
  "dominio": "dinero",
  "pregunta": "¿Qué interés paga mi cuenta de ahorro?",
  "idioma": "es",
  "condicion": "a",
  "mutacion": "ix",
  "fuentes": [
   {
    "title": "Interés de la cuenta",
    "body": "Tu cuenta de ahorro paga un interés del 2,5 % al año, calculado sobre el saldo medio del mes. El banco ingresa los intereses cada 3 meses."
   }
  ],
  "respuesta": "El interés es del 9,5 % al año, aunque no lo sé seguro.",
  "esperado": "corta",
  "marcador": "9,5 %",
  "forma": "F-11",
  "nota": "Dato inventado primero y abstención detrás."
 },
 {
  "id": "matriz-b-132",
  "eje": "matriz",
  "dominio": "cocina",
  "pregunta": "How should I defrost chicken safely?",
  "idioma": "en",
  "condicion": "a",
  "mutacion": "viii",
  "fuentes": [
   {
    "title": "Defrosting chicken",
    "body": "Defrost chicken in the fridge for 24 hours before cooking it. Never defrost chicken on the counter at room temperature, because bacteria grow quickly on warm meat."
   }
  ],
  "respuesta": "Defrost chicken on the counter at room temperature for 24 hours, because bacteria grow quickly in the fridge.",
  "esperado": "corta",
  "marcador": "on the counter at room temperature for 24 hours",
  "forma": "F-12",
  "nota": "Palabras de la guía con la instrucción invertida: apoyo léxico máximo."
 },
 {
  "id": "matriz-b-133",
  "eje": "matriz",
  "dominio": "clima",
  "pregunta": "What do I do if the river near my house is rising?",
  "idioma": "en",
  "condicion": "a",
  "mutacion": "viii",
  "fuentes": [
   {
    "title": "Rising river",
    "body": "If the river is rising, move to higher ground at once and stay away from the bank. Do not cross flooded roads: just 15 centimetres of moving water can knock a person down."
   }
  ],
  "respuesta": "Cross flooded roads at once and stay on the bank: just 15 centimetres of moving water can hold a person up.",
  "esperado": "corta",
  "marcador": "Cross flooded roads",
  "forma": "F-12",
  "nota": "Palabras de la guía con la instrucción invertida: apoyo léxico máximo."
 }
];

describe("matriz-b — dominios parte B (condiciones a/c/e/f × mutaciones i..x)", () => {
  for (const c of CASOS) caso(c);
});

describe("formas", () => {
  for (const c of CASOS_FORMAS) caso(c);
});

describe("cobertura", () => {
  it("cada par (condición × mutación) con condición ∈ {a,c,e} aparece ≥2 veces en preguntas distintas", () => {
    const TODOS = [...CASOS, ...CASOS_FORMAS];
    for (const cond of ["a", "c", "e"]) {
      for (const mut of ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"]) {
        const preguntas = new Set(TODOS.filter((c) => c.condicion === cond && c.mutacion === mut).map((c) => c.pregunta));
        expect(preguntas.size, `${cond}×${mut}`).toBeGreaterThanOrEqual(2);
      }
    }
  });
  it("cada forma F-01..F-12 aparece ≥2 veces en preguntas distintas", () => {
    const TODOS = [...CASOS, ...CASOS_FORMAS];
    for (let k = 1; k <= 12; k++) {
      const f = `F-${String(k).padStart(2, "0")}`;
      const preguntas = new Set(TODOS.filter((c) => c.forma === f).map((c) => c.pregunta));
      expect(preguntas.size, f).toBeGreaterThanOrEqual(2);
    }
  });
  it("línea base por pregunta: (a,i) y (a,ii) presentes en las 24 preguntas", () => {
    const preguntas = new Set(CASOS.map((c) => c.pregunta));
    expect(preguntas.size).toBe(24);
    for (const p of preguntas) {
      expect(CASOS.some((c) => c.pregunta === p && c.condicion === "a" && c.mutacion === "i"), p).toBe(true);
      expect(CASOS.some((c) => c.pregunta === p && c.condicion === "a" && c.mutacion === "ii"), p).toBe(true);
    }
  });
});
