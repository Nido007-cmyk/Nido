/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Respuestas de referencia del conjunto fresco 04 (blindSet4.ts):
 * la línea base «frontera» del método (docs/BLIND_EVAL.md), en el
 * mismo estilo que las de los conjuntos 01 a 03: prosa llana de
 * experto al teléfono, 2–6 frases, sin adivinar lo no comprobable.
 *
 * Hechos asentados al escribirlas (conocimiento estándar estable,
 * sin hechos volátiles en este conjunto): el río más largo de
 * América del Sur es el Amazonas; la araña tiene ocho patas; la
 * montaña más alta es el Everest; la Mona Lisa es de Leonardo da
 * Vinci; la reanimación boca a boca se describió a finales de los
 * años cincuenta (1958 es el año que la propia fila declara, y de
 * 1958 a 2026 van 68 años); la RCP sigue la guía corriente (llamar,
 * empujar fuerte y rápido en el centro del pecho, 100 a 120 por
 * minuto, 30:2 si se sabe dar respiraciones).
 *
 * Las referencias de emergencia y salud puntúan a ciegas cualquier
 * texto fijo que la capa determinista sirva; si ninguna ruta fija
 * dispara, la corrida lo cuenta como fallo de enrutado contra la
 * clave y no hay texto que puntuar.
 */

export const BLIND_REFERENCES_4: Record<string, string> = {
  e1: "Que el enfermero siga sin parar: empujar fuerte y rápido en el centro del pecho, de 100 a 120 veces por minuto, dejando que el pecho suba del todo. Llama tú al número de emergencias ahora, o grita a una persona concreta que llame y traiga un desfibrilador si hay uno cerca. No interrumpáis para mirar el teléfono: solo se para si la persona respira normal, si llega el relevo o si quien empuja está agotado y otro toma el turno.",
  e2: "Keep the compressions going without stopping: push hard and fast in the center of the chest, 100 to 120 times a minute, and let the chest come fully back up. Call your emergency number now on speakerphone, or point at one specific person and tell them to call and fetch a defibrillator if there is one nearby. Switch pushers every 2 minutes if someone else can take over, and stop only if he starts breathing normally or help takes over.",
  e3: "Que ela continue sem parar: empurrar com força e depressa no centro do peito, de 100 a 120 vezes por minuto, deixando o peito voltar a subir por completo. Liga tu agora para o número de emergência, ou grita a uma pessoa concreta que ligue e traga um desfibrilador se houver um perto. Revezem a cada 2 minutos se houver mais alguém, e só parem se ele respirar normalmente ou se a ajuda assumir.",
  e4: "Seguid sin parar: dos minutos es poco, la reanimación funciona por acumulación y parar la deshace. Empujad fuerte y rápido en el centro del pecho y turnaos ya si hay otra persona, sin detener las compresiones en el cambio. Si aún no ha llamado nadie, que llame quien no esté empujando y pida un desfibrilador. Si la persona empieza a respirar normal o a moverse, parad y ponedla de lado vigilándola.",

  s1: "Así se hace: comprueba que el lugar es seguro, toca sus hombros y háblale fuerte; si no responde y no respira normal, pide que llamen al número de emergencias y traigan un desfibrilador. Túmbala boca arriba en el suelo, pon el talón de una mano en el centro del pecho y la otra encima, brazos rectos, y empuja con el peso del cuerpo unos 5 cm, de 100 a 120 veces por minuto, dejando que el pecho suba del todo y sin parar. Si estás entrenado, 30 compresiones y 2 respiraciones, y a repetir. Aprenderlo en un curso práctico es lo que lo deja bien aprendido.",
  s2: "Puedes hacerlo sola: primero llama al número de emergencias con el altavoz puesto y deja el teléfono en el suelo, así la ayuda viene mientras empujas. Persona boca arriba en el suelo, talón de una mano en el centro del pecho y la otra encima, brazos rectos y hombros sobre las manos. Empuja con el peso del cuerpo, unos 5 cm de profundidad, de 100 a 120 por minuto, y deja que el pecho suba del todo entre compresión y compresión. Solo compresiones, sin parar, hasta que respire o llegue la ayuda.",
  s3: "Podes aprender a base em casa, mas o curso prático é o que fixa o gesto: procura um curso certificado antes de começares. O essencial: se a pessoa não responde e não respira normalmente, liga para a emergência no viva-voz e começa. Deitada de costas no chão, a base de uma mão no centro do peito e a outra por cima, braços retos; empurra com o peso do corpo, cerca de 5 cm, de 100 a 120 vezes por minuto, deixando o peito voltar por completo. Só compressões já serve se não souberes dar respirações.",
  s4: "Good plan: before the course, know the shape of it. If someone does not respond and is not breathing normally, call your emergency number on speakerphone and start at once: person on their back on the floor, heel of one hand in the center of the chest, other hand on top, arms straight, push with your body weight about 5 cm deep, 100 to 120 times a minute, letting the chest come fully back up. Compressions only is fine if you have no training in breaths. The hands-on course is what makes it stick.",

  h1: "El Amazonas: es el río más largo de América del Sur, con unos 6.400 km según la medición que se acepte, y el de mayor caudal del mundo con diferencia.",
  h2: "Eight. All spiders have eight legs, along with two body parts and no wings or antennae; that is part of what makes them arachnids rather than insects.",
  h3: "O Evereste, na cordilheira dos Himalaias, entre o Nepal e a China: 8.849 metros acima do nível do mar, pela medição mais recente aceite pelos dois países.",
  h4: "Leonardo da Vinci. La pintó a principios del siglo XVI, la llevó consigo a Francia, y hoy se guarda en el Louvre, en París.",

  c1: "A 8 litros cada 100 km, en 350 km gasta 3,5 veces eso: 28 litros.",
  c2: "15 percent of 240 is 36: ten percent is 24 and five percent is 12.",
  c3: "900 dividido por 45 dá 20: o tanque fica vazio em 20 dias.",
  c4: "37 por 6 son 222: 30 por 6 son 180 y 7 por 6 son 42.",

  x1: "Un termómetro de mercurio mide con dilatación: el mercurio es un metal líquido que se expande de forma regular cuando se calienta. Al subir la temperatura, el mercurio sube por un tubo de vidrio muy fino, y la altura que alcanza se lee contra una escala graduada. Al enfriarse se contrae y baja. Es el mismo principio en el termómetro de alcohol, tiñendo el líquido para verlo mejor.",
  x2: "A seed holds an embryo plant plus a store of food, wrapped in a tough coat. With water, warmth and air, the coat splits, a root grows down and a shoot grows up toward the light. Once the first leaves open, the plant makes its own food from sunlight and no longer needs the seed's store.",
  x3: "O arco-íris forma-se quando a luz do Sol atravessa gotas de chuva que ainda estão no ar. Cada gota dobra e separa a luz branca nas suas cores e reflete-a de volta, por isso o arco aparece sempre em frente, do lado oposto ao Sol. Vê-se melhor com a chuva a afastar-se e o Sol baixo atrás de quem olha.",
  x4: "Light travels almost a million times faster than sound. The flash reaches your eyes nearly at once, while the thunder, which is the sound of the same lightning heating the air, arrives seconds later. Counting the seconds between them and dividing by about three gives the distance in kilometres.",

  p1: "Es una escena verosímil: en un tren hay espacio justo, pero la reanimación se hace donde la persona cae, con ella tumbada boca arriba sobre una superficie firme; en la ficción suele resumirse lo que en la realidad son compresiones sin parar hasta que llega ayuda o un desfibrilador. Si el pasajero respira o se mueve, ahí sí se para y se le pone de lado.",
  p2: "Take the warning seriously: balloons are one of the classic choking hazards for small children, because a burst or uninflated balloon can seal a child's airway completely. Keep them away from under-eights, pick up every burst fragment at once, and never let a child put a balloon to their mouth to blow it up unsupervised.",
  p3: "De 1958 a 2026 vão 68 anos. A técnica tinha raízes mais antigas em descrições de ventilação boca a boca, mas foi na década de 1950 que Elam e Safar a demonstraram e a fixaram como prática, pouco antes de as compressões externas completarem a RCP moderna.",
  p4: "It is a plausible scene as written: on a beach the rescuer works where the swimmer was brought out, on firm wet sand, with compressions that should not stop until help or a defibrillator arrives. Films usually compress the time; in reality the crowd's useful jobs are calling for help, fetching the defibrillator and clearing space, exactly the watching ring your scene has standing by.",
};
