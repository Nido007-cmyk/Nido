/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Respuestas de referencia del conjunto fresco 03 (blindSet3.ts):
 * la línea base «frontera» del método (docs/BLIND_EVAL.md), en el
 * mismo estilo que las de los conjuntos 01 y 02: prosa llana de
 * experto al teléfono, 2–6 frases, sin adivinar lo no comprobable.
 *
 * Hechos asentados al escribirlas (conocimiento estándar estable,
 * sin hechos volátiles en este conjunto): la pandemia de gripe de
 * 1918 causó del orden de 50 millones de muertes según las
 * estimaciones más aceptadas; la pandemia de 1957–58 (H2N2) causó
 * del orden de un millón de muertes en el mundo; antes de los
 * antibióticos la neumonía era una causa principal de muerte y
 * morir en pocos días era común; la dosis oral habitual de
 * metamizol en adultos es de 500 mg a 1 g por toma, con un máximo
 * de 4 g al día donde su uso está autorizado; la amoxicilina
 * infantil se calcula por peso (a menudo 40–50 mg/kg/día repartidos
 * en 2–3 tomas) y la fija quien prescribe; el paracetamol en
 * adultos: 500 mg a 1 g cada 4–6 horas, máximo 4 g al día;
 * Cervantes publicó el Quijote en 1605 y 1615; la Segunda Guerra
 * Mundial terminó en 1945; Camberra es la capital de Australia.
 *
 * Las referencias de emergencia y salud puntúan a ciegas cualquier
 * texto fijo que la capa determinista sirva; si ninguna ruta fija
 * dispara, la corrida lo cuenta como fallo de enrutado contra la
 * clave y no hay texto que puntuar.
 */

export const BLIND_REFERENCES_3: Record<string, string> = {
  e1: "Llama ahora mismo al número de emergencias y no cuelgues hasta que te lo digan. No lo muevas: una caída de esa altura puede haberle lesionado el cuello o la espalda; solo muévelo si donde está corre más peligro. Si sangra mucho, aprieta la herida con un paño limpio o con la mano y no levantes el paño aunque se empape: pon otro encima y sigue apretando. Abrígalo, no le des de comer ni de beber y quédate con él vigilando si responde y respira hasta que llegue la ayuda.",
  e2: "If she is coughing hard or crying, encourage her to keep coughing and watch her closely. If she cannot breathe, speak or cough with force: hold her face-down along your forearm with her head low and give 5 firm blows between the shoulder blades; for a toddler you can sit her leaning forward on your lap. If the coin does not come out, give 5 abdominal thrusts (chest thrusts for a baby under one year) and keep alternating. Call your emergency number now, and never sweep a finger blindly inside her mouth — only remove what you can clearly see.",
  e3: "Afasta móveis e objetos de perto dela e protege-lhe a cabeça com algo macio, sem a segurar nem tentar pará-la. Não metas nada na boca dela. Conta o tempo da convulsão. Quando parar, vira-a de lado e verifica se respira normalmente. Liga para o número de emergência já, e sem falta se a convulsão passar de 5 minutos, se se repetir, se for a primeira vez ou se ela não voltar a si.",
  e4: "Salgan todos ya, sin parar a por cosas, y cierra la puerta de la sala al salir si puedes hacerlo sin acercarte al fuego. Llama a los bomberos desde fuera o desde casa de un vecino y no vuelvas a entrar por nada. Si el humo ya llena el paso, agáchense: el aire más limpio está cerca del suelo. Si no pueden salir, cierren la puerta de la habitación, tapen las rendijas con ropa o toallas y hagan señales desde la ventana para que los vean.",

  s1: "En adultos, la dosis oral habitual de metamizol es de 500 mg a 1 g por toma, cada 6 a 8 horas, con un máximo de 4 g al día. Es un medicamento con receta en muchos países y está retirado en otros por un riesgo raro pero grave en la sangre, así que no lo uses por tu cuenta: sigue el prospecto de tu presentación y, si el dolor no cede, que lo valore un médico.",
  s2: "Yes, a baby with 39 degrees for a full day who is not eating deserves to be seen today, and sooner if he is under three months old, unusually sleepy, breathing fast or with the ribs showing, has dry nappies, cries without tears or has a rash that does not fade when pressed. Keep offering milk or small sips of fluid, do not bundle him up, and give paracetamol or ibuprofen only at the dose on the label for his weight. Fever itself is a symptom, not the danger: the warning signs in the first sentence are what matters.",
  s3: "A dose de amoxicilina para uma criança calcula-se pelo peso, não só pela idade: o habitual em infeções comuns é 40 a 50 mg/kg por dia, repartidos em 2 ou 3 tomas, e em infeções mais graves pode ser mais. Sem saber o peso do seu filho, a concentração da suspensão e o que se está a tratar, ninguém lhe pode dar um número seguro: é um antibiótico com receita, por isso a dose certa é a que escrever quem o prescrever ou a que vier na receita.",
  s4: "For a healthy 70 kg adult, acetaminophen is 500 mg to 1 g per dose, every 4 to 6 hours as needed, and never more than 4 g in 24 hours from all sources combined. Standard adult dosing does not really change with weight at 70 kg. Check other products you are taking — many cold and flu remedies already contain it — and stay well under the limit if you drink alcohol regularly or have liver problems.",

  h1: "El océano Pacífico: es el más grande y el más profundo de la Tierra, con unos 165 millones de kilómetros cuadrados, cerca de un tercio de la superficie del planeta.",
  h2: "Miguel de Cervantes wrote Don Quixote: the first part came out in 1605 and the second in 1615. It is usually counted as the first modern novel.",
  h3: "A capital da Austrália é Camberra. Sydney é a cidade mais conhecida e a maior, mas a capital federal, escolhida como compromisso entre Sydney e Melbourne, é Camberra.",
  h4: "Terminó en 1945: en Europa en mayo, con la rendición de Alemania, y en el Pacífico en septiembre, con la rendición formal de Japón el 2 de septiembre de 1945.",

  c1: "El 12% de 1.500 es 180: el 10% son 150 y el 2% son 30.",
  c2: "Average speed is distance divided by time: 180 miles in 4 hours is 45 miles per hour.",
  c3: "Três cadernos a 12 reais são 36 reais. Pagando com 50, o troco é de 14 reais.",
  c4: "A 20 litros por hora durante 6 horas caben 120 litros en total.",

  x1: "La luz del sol parece blanca, pero está hecha de colores. Al entrar en la atmósfera, las moléculas del aire dispersan sobre todo la parte azul de la luz, y la mandan en todas direcciones: por eso todo el cielo se ve azul. Al atardecer la luz recorre más atmósfera, el azul se pierde por el camino y quedan los tonos rojizos.",
  x2: "A bicycle stays upright mainly because the rider keeps steering the front wheel back under the body's line: tiny, constant corrections steer into each small lean before it grows. The geometry helps — the front fork is angled so the wheel tends to align itself with the direction of travel — and once moving at a decent speed those corrections are small and easy. It is not the spinning wheels' gyroscopic effect doing the work, as was long believed.",
  x3: "A Lua não muda de forma: o que muda é a parte iluminada que vemos da Terra. O Sol ilumina sempre metade da Lua, e ao longo do mês, enquanto ela gira à volta da Terra, vemos essa metade iluminada de ângulos diferentes: lua nova, crescente, cheia e minguante. É a mesma geometria que explica as fases de Vénus vistas com um telescópio pequeno.",
  x4: "A refrigerator moves heat instead of making cold. A pump compresses a gas, which gets hot and sheds that heat through coils at the back; the gas then expands inside the cabinet, turning cold and absorbing heat from the food and the air inside. The cycle repeats, carrying heat from the inside to the kitchen — which is why the back of a fridge feels warm.",

  p1: "No existe un recuento exacto: los registros de la época son incompletos y la fiebre tifoidea se confunde a menudo con el tifus, que fue el gran asesino epidémico de aquel frente. Lo que se acepta es que las enfermedades infecciosas en conjunto mataron a millones de soldados y civiles durante la guerra, con cientos de miles de muertes atribuibles a la fiebre tifoidea sobre todo antes de que la vacunación y la higiene del agua se impusieran en los ejércitos. Cualquier cifra única y precisa que veas debe tratarse con sospecha.",
  p2: "The usual estimate is around 50 million deaths worldwide, with honest ranges running from about 17 million to 100 million because records at the time were incomplete and many countries kept none. In the United States alone about 675,000 people died. It remains the deadliest pandemic of the modern era, ahead of anything since.",
  p3: "A pandemia de 1957–58, a chamada gripe asiática (H2N2), chegou ao Brasil em 1957 pelos portos e espalhou-se pelas grandes cidades com os transportes e as escolas. Causou uma onda forte de doença, com hospitais cheios e mortalidade concentrada nos idosos e nos mais frágeis; no mundo inteiro, as estimativas ficam na ordem de um milhão de mortes. No Brasil não houve um colapso como o de 1918, mas a pandemia empurrou a vigilância sanitária e a produção nacional de vacinas.",
  p4: "Era comum, sim. Antes dos antibióticos — a penicilina só se generalizou nos anos 1940 — a pneumonia era uma das principais causas de morte, e uma pneumonia lobar podia matar um adulto saudável em poucos dias, na chamada «crise» da doença. William Osler chamou-lhe «a amiga dos velhos», porque muitas vezes era ela que os levava no fim da vida. Um romance do século XIX que mata uma personagem de pneumonia em dias está a ser realista, não melodramático.",
};
