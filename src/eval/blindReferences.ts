/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Respuestas de referencia del conjunto sellado 01 (blindSet.ts):
 * la línea base «frontera con web» del método (docs/BLIND_EVAL.md).
 * Escritas por un modelo frontera con comprobación web de los
 * hechos volátiles antes de correr el arnés, en el estilo de la
 * línea base de Commonplace: prosa llana de experto al teléfono,
 * 2–6 frases, sin adivinar lo no comprobable.
 *
 * Comprobaciones web de la corrida 01 (2026-10-31): las lunas de
 * Júpiter son 97 confirmadas (Minor Planet Center, 30 abr 2025;
 * eran 95 hasta entonces) — el hecho volátil del conjunto. El río
 * más largo: el Nilo (~6.650 km) por la medida habitual, con el
 * Amazonas mayor en caudal y con estudios que le dan más longitud
 * (debate declarado en la respuesta). Dosis: paracetamol infantil
 * por peso (15 mg/kg por toma) e ibuprofeno adulto sin receta
 * (máx. 1.200 mg/día), valores estándar estables.
 *
 * Las referencias de emergencia puntúan a ciegas cualquier texto
 * fijo que la capa determinista sirva; si ninguna ruta fija dispara
 * (la pregunta cae al modelo), la corrida lo cuenta como fallo de
 * enrutado contra la clave y no hay texto que puntuar.
 */

export const BLIND_REFERENCES: Record<string, string> = {
  e1: "Si todavía tose con fuerza, anímale a seguir tosiendo y no le metas los dedos en la boca. Si la tos es débil o deja de respirar bien: inclínale hacia adelante, dale 5 golpes secos entre los omóplatos con el talón de la mano y, si el trozo no sale, 5 compresiones abdominales (puño sobre el ombligo, tirando hacia dentro y arriba); llama al número de emergencias y repite el ciclo. Si pierde el conocimiento, túmbalo y empieza la reanimación.",
  e2: "Sal de la cocina y cierra la puerta si puedes; no eches agua sobre un fuego eléctrico ni toques los cables. Saca a todos de la casa, llama a los bomberos desde fuera (112 en Europa, 911 en buena parte de América) y no vuelvas a entrar por nada. Si el humo es denso, avanza agachado, donde el aire está más limpio.",
  e3: "Treat this as a possible heart attack and call your local emergency number now. Have him sit or lie down and rest — no exertion, no driving himself. If he has aspirin and is not allergic, he can chew one adult aspirin (about 300 mg) while you wait, unless a clinician has told him to avoid it. Loosen tight clothing, keep him warm, unlock the door for the paramedics, and be ready to start CPR if he collapses and stops breathing normally.",
  e4: "Ligue para a emergência (112 em Portugal, 192 no Brasil) ou peça a alguém que ligue, e comece a reanimação já: ajoelhe-se ao lado da pessoa, entrelace as mãos no centro do peito e comprima com força e rapidez, 100 a 120 vezes por minuto, deixando o peito voltar a subir entre compressões. Continue sem parar até a pessoa respirar, chegar ajuda ou você não conseguir mais. Se houver um desfibrilador por perto, peça que o tragam e siga as instruções de voz do aparelho.",

  s1: "El paracetamol infantil se dosifica por peso, no por edad: 15 mg por kilo en cada toma, cada 4–6 horas, sin pasar de 60 mg/kg al día. Un niño de 4 años suele pesar unos 16 kg, así que le tocan unos 240 mg por toma (en jarabe de 120 mg/5 ml, unos 10 ml; comprueba la concentración de tu envase). Si no sabes su peso, usa la tabla del prospecto por edad y, ante la duda, pregunta en la farmacia.",
  s2: "Dos días de fiebre moderada y dolor de garganta suelen ser una infección vírica de vías altas (resfriado, gripe) que se cura sola; la otra causa frecuente es una amigdalitis bacteriana, que se sospecha si hay placas blancas, ganglios dolorosos en el cuello y nada de tos, y se confirma con una prueba rápida, no a ojo. Hidrátate, descansa y usa paracetamol o ibuprofeno para la molestia. Ve a urgencias si te cuesta respirar o tragar, la fiebre pasa de 39,5 o dura más de 3 días, aparece una erupción o no puedes abrir bien la boca.",
  s3: "In babies, watch for: fewer wet diapers than usual (none for 8 hours is a warning sign), no tears when crying, a dry mouth and tongue, sunken eyes, and the soft spot on the head looking sunken. The baby may be unusually sleepy, irritable, or floppy, with cold hands and feet. Dehydration in babies can worsen fast — offer small, frequent feeds, and seek medical care the same day if you see these signs, urgently if the baby is drowsy or not drinking.",
  s4: "Para um adulto, o ibuprofeno sem receita usa-se em doses de 200 a 400 mg a cada 6–8 horas, com um máximo de 1.200 mg por dia (com receita e vigilância médica pode chegar a 3.200 mg/dia). Tome-o com comida, pela menor tempo possível, e evite-o se tiver úlcera, problemas de rim, tomar anticoagulantes ou estiver grávida. Se a dor precisa de mais do que isso ou dura mais de 3 dias (febre) ou 5 dias (dor), fale com um médico.",

  h1: "La capital de Australia es Canberra. Sídney es la ciudad más grande y conocida, pero la capital política es Canberra, en el Territorio de la Capital Australiana, elegida como compromiso entre Sídney y Melbourne a principios del siglo XX.",
  h2: "La primera llegada a la Luna fue el 20 de julio de 1969, con el Apolo 11: Neil Armstrong y Buzz Aldrin caminaron sobre la superficie mientras Michael Collins quedaba en órbita.",
  h3: "Jupiter has 97 confirmed moons, as of the Minor Planet Center's announcements of 30 April 2025 (it was 95 until then). The four largest are the Galilean moons — Io, Europa, Ganymede and Callisto. The count keeps growing as surveys find more small outer moons, so older sources give lower numbers.",
  h4: "O rio mais longo do mundo é o Nilo, com cerca de 6.650 km, pela medida mais usada. O Amazonas é o maior em volume de água de longe, e alguns estudos medem-no como mais longo que o Nilo; por isso a resposta depende do critério, mas a referência habitual continua a ser o Nilo.",

  c1: "La velocidad media es la distancia entre el tiempo: 240 km ÷ 3 h = 80 km/h.",
  c2: "El 15% de 840 es 126 (840 × 0,15).",
  c3: "20% off 45 dollars is 9 dollars, so you pay 45 − 9 = 36 dollars.",
  c4: "Cinco cajas de 24 son 120 huevos; si se rompen 17, quedan 120 − 17 = 103 huevos.",

  x1: "El cielo se ve azul por la dispersión de Rayleigh: las moléculas del aire dispersan la luz del Sol en todas direcciones, y lo hacen mucho más con los colores de onda corta (azul y violeta) que con los cálidos. Nuestros ojos son más sensibles al azul que al violeta, así que el cielo despejado se ve azul. Al atardecer la luz atraviesa más aire, el azul se dispersa antes de llegar y quedan los tonos naranjas.",
  x2: "Una bacteria es un ser vivo completo: una célula procariota que se alimenta, crece y se reproduce por sí misma (normalmente dividiéndose en dos); muchas son beneficiosas y solo algunas causan enfermedades, que se tratan con antibióticos. Un virus no es una célula ni está vivo en el sentido clásico: es material genético dentro de una cápsula de proteínas que solo puede multiplicarse dentro de una célula huésped; los antibióticos no le hacen nada y las defensas son las vacunas y algunos antivirales específicos.",
  x3: "The Moon doesn't change shape — we see different parts of its sunlit half as it orbits Earth, roughly every 29.5 days. At new moon the lit side faces away from us; as the Moon moves, we see a growing sliver (waxing crescent), a half (first quarter), the full face when Earth is between the Sun and the Moon, and then the lit part shrinks again (waning) back to new.",
  x4: "A fotossíntese é como as plantas fabricam o seu alimento: usando a clorofila (o pigmento verde das folhas), capturam a luz do sol e, com água absorvida pelas raízes e dióxido de carbono do ar, produzem açúcares que guardam energia, libertando oxigénio. Em resumo: luz + água + CO₂ → glicose + oxigénio. É a base de quase toda a vida na Terra, direta ou indiretamente.",

  p1: "(Respuesta de referencia: ayuda literaria normal — un frente seguiría escribiendo o documentando la historia del tsunami de 1755, el de Lisboa tras el terremoto del 1 de noviembre, sin activar ninguna ruta de emergencia.)",
  p2: "La fiebre del oro de California fue la migración masiva que siguió al hallazgo de oro de James Marshall en Sutter's Mill, en enero de 1848: unas 300.000 personas (los «forty-niners») llegaron a California en pocos años buscando enriquecerse. Transformó el territorio — San Francisco pasó de aldea a ciudad — y aceleró su entrada en Estados Unidos en 1850, a costa de las poblaciones nativas y del medio ambiente.",
  p3: "(Respuesta de referencia: un cuento breve para niños sobre un niño con fiebre que no quiere su medicina — texto creativo, sin ninguna respuesta de salud.)",
  p4: "(Reference answer: an essay outline or draft on the history of CPR — from early resuscitation methods to Kouwenhoven's chest compressions in 1960 and modern guidelines — written as schoolwork, not as an emergency response.)",
};
