/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * 0.1.89: el clúster REAL del turno del gas, extraído del sqlite
 * del pack firmado del dueño (salvora-emergencias-casa.sqlite)
 * con la consulta FTS exacta que la app construye para «Que hago
 * si huele a gas en mi casa?» (`"huele" OR "huel"* OR "gas" OR
 * "casa"`, la SQL de searchPacks con bm25(chunks_fts)) y la
 * puerta de cobertura de la casa (requiredTermMatches(3) = 2,
 * cobertura sobre título, cuerpo y keys v2). Son los 23
 * fragmentos fundados, en el orden BM25 real, con su rank real:
 * el 127 (monóxido) es el n.º 1 del pack y el 131 (fuga) el
 * n.º 3, ambos con cobertura 3/3. Nada puesto a mano: la
 * medición entera está en
 * research_notes/nido-gas-0.1.88-dirimen-2026-11-09.md.
 */
export interface RealClusterChunk {
  id: number;
  title: string;
  body: string;
  keys: string;
  bm25Rank: number;
  coverage: number;
}

export const SALVORA_GAS_CLUSTER_REAL: RealClusterChunk[] = [
  {
    "id": 127,
    "title": "Monóxido de carbono: detectores, prevención y qué hacer si suena la alarma",
    "body": "El monóxido de carbono, o CO, es un gas sin olor y sin color que mata sin avisar. Lo producen al quemar combustible equipos tan comunes como las calderas de gas o de petróleo, los generadores portátiles y las parrillas de carbón. Como no se puede ver ni oler, la protección en casa depende de dos cosas: detectores que funcionen y una revisión anual de los equipos de combustión.",
    "keys": "¿Por qué el monóxido de carbono es tan peligroso si no se ve ni se huele?\n¿Dónde van los detectores de CO y cómo se mantienen?\n¿Qué equipos de casa hay que revisar cada año?\n¿Qué hago si suena la alarma de CO?",
    "bm25Rank": -10.6672,
    "coverage": 3
  },
  {
    "id": 116,
    "title": "Baterías de litio en casa: comprar, cargar y guardar con seguridad — Señales de problema",
    "body": "Señales de problema\nDeja de usar el aparato de inmediato si la batería huele raro, se calienta demasiado, hace ruidos como estallidos, se hincha o cambia de forma o de color. Si es seguro hacerlo, aleja el aparato de todo lo que puede arder y llama al 911.",
    "keys": "",
    "bm25Rank": -10.3724,
    "coverage": 2
  },
  {
    "id": 131,
    "title": "Fuga de gas: cómo reconocerla y salir a tiempo — Reconocer la fuga",
    "body": "Esta guía trata del gas natural que llega por tubería. Una fuga puede reconocerse por el olor, por el sonido y por la vista. La respuesta segura no es buscar su origen, sino salir a pie y llamar desde fuera.\n\nReconocer la fuga\nPor el olor: un olor inusual, a petróleo o gaseoso. Los sistemas de distribución añaden mercaptano, una sustancia inofensiva, con un olor parecido al de un zorrillo, para que la fuga se pueda detectar.\n\nPor el sonido: el volumen puede ir de un silbido suave a un rugido fuerte, según el tamaño de la fuga.\n\nPor la vista: tierra despedida alrededor de la zona de la tubería, burbujas continuas en zonas mojadas o inundadas, y plantas muertas o descoloridas en medio de una zona de vegetación sana.",
    "keys": "¿Cómo se reconoce una fuga de gas natural por el olor, el sonido y la vista?\n¿Qué no debo hacer nunca ante una sospecha de fuga?\n¿Desde dónde llamo y a quién aviso?\n¿Cuándo hay que llamar al 811?\nHuele mucho a huevo podrido en mi cocina y creo que es gas, ¿qué hago?\n¿Qué hago si siento un olor fuerte a gas en casa?",
    "bm25Rank": -9.3133,
    "coverage": 3
  },
  {
    "id": 142,
    "title": "Cortar la luz, el agua y el gas: dónde están las llaves y cómo se cierran — El gas: con llave y un cuarto de vuelta",
    "body": "El gas: con llave y un cuarto de vuelta\nLa válvula está junto al contador. Si la palanca va paralela a la tubería, el gas está abierto. Con una llave o unos alicates, gírala 90 grados, un cuarto de vuelta, hasta que quede perpendicular a la tubería: así queda cerrado.\n\nSi hueles gas o escuchas un soplido o un silbido, abre una ventana, saca a todos de la casa enseguida, cierra el gas con la válvula principal exterior si puedes y llama a la compañía de gas desde la casa de un vecino.\n\nAdvertencia: si cierras el gas por cualquier motivo, solo un profesional cualificado puede volver a abrirlo. No intentes abrirlo tú nunca.",
    "keys": "",
    "bm25Rank": -7.1958,
    "coverage": 3
  },
  {
    "id": 227,
    "title": "Cortar luz, água e gás: onde ficam as válvulas e como fechá-las — O gás: com chave e um quarto de volta",
    "body": "O gás: com chave e um quarto de volta\nA válvula fica junto ao medidor. Se a alavanca estiver paralela ao cano, o gás está aberto. Com um alicate ou uma chave, vire-a 90 graus, um quarto de volta, até que fique perpendicular ao cano: assim fica fechado.\n\nSe você sentir cheiro de gás ou ouvir um sopro ou um assobio, abra uma janela, tire todos de casa depressa, feche o gás com a válvula principal externa se puder e ligue para a companhia de gás da casa de um vizinho.\n\nAdvertência: se você fechar o gás por qualquer motivo, só um profissional qualificado pode reabri-lo. Nunca tente reabri-lo você mesmo.",
    "keys": "",
    "bm25Rank": -3.4199,
    "coverage": 2
  },
  {
    "id": 225,
    "title": "Cortar luz, água e gás: onde ficam as válvulas e como fechá-las",
    "body": "Em um desastre, você pode ser orientado a cortar os serviços da sua casa. A FEMA pede que todos os membros da família saibam fechar o gás, a água e a luz antes que esse momento chegue, e que o percurso seja aprendido com calma, não durante a emergência.",
    "keys": "Onde fica a válvula principal da água e como verifico?\nComo fecho o gás no medidor?\nQuem pode reabrir o gás?\nComo corto a luz no quadro?\nUm cano estourou, onde fecho a água da casa?\nOnde fica a válvula para fechar a água quando um cano estoura?",
    "bm25Rank": -3.1088,
    "coverage": 2
  },
  {
    "id": 140,
    "title": "Cortar la luz, el agua y el gas: dónde están las llaves y cómo se cierran",
    "body": "En un desastre te pueden indicar que cortes los servicios de tu casa. La FEMA pide que todos los miembros de la familia sepan cerrar el gas, el agua y la luz antes de que llegue ese momento, y que el recorrido se aprenda con calma, no durante la emergencia.",
    "keys": "¿Dónde está la llave principal del agua y cómo se comprueba?\n¿Cómo se cierra el gas en el contador?\n¿Quién puede volver a abrir el gas?\n¿Cómo se corta la luz en el tablero?\nSe rompió una tubería, ¿dónde cierro el agua de la casa?\n¿Dónde está la llave de paso para cerrar el agua si se revienta una tubería?",
    "bm25Rank": -3.0373,
    "coverage": 2
  },
  {
    "id": 226,
    "title": "Cortar luz, água e gás: onde ficam as válvulas e como fechá-las — Antes da emergência: localize as três válvulas",
    "body": "Antes da emergência: localize as três válvulas\nÁgua: localize a válvula de corte da linha principal que entra na sua casa e coloque uma etiqueta para identificá-la com facilidade. Verifique se ela fecha por completo: se estiver travada por ferrugem ou não fechar tudo, troque-a. Que toda a família saiba onde ela fica.\n\nGás: cada medidor tem seu próprio procedimento, então ligue para a sua companhia de gás e aprenda o do seu medidor. Pratique o percurso sem fechar o gás de verdade.\n\nLuz: localize o quadro de circuitos e ensine os membros responsáveis da casa a cortar a eletricidade.\n\nFerramenta: a lista do kit de emergências do Ready.gov inclui uma chave ou um alicate para fechar os serviços. Deixe essa ferramenta à mão, junto das válvulas.",
    "keys": "",
    "bm25Rank": -2.9361,
    "coverage": 2
  },
  {
    "id": 141,
    "title": "Cortar la luz, el agua y el gas: dónde están las llaves y cómo se cierran — Antes de la emergencia: localiza las tres llaves",
    "body": "Antes de la emergencia: localiza las tres llaves\nAgua: localiza la llave de paso de la línea principal que entra en tu casa y etiquétala para identificarla fácil. Comprueba que cierra por completo: si está oxidada o no cierra del todo, cámbiala. Que toda la familia sepa dónde está.\n\nGas: cada contador tiene su propio procedimiento, así que llama a tu compañía de gas y aprende el de tu contador. Practica el recorrido sin cerrar el gas de verdad.\n\nLuz: localiza el tablero de circuitos y enseña a los miembros responsables de la casa cómo cortar la electricidad.\n\nHerramienta: la lista del kit de emergencias de Ready.gov incluye una llave o unos alicates para cerrar los servicios. Ten esa herramienta a mano, junto a las llaves.",
    "keys": "",
    "bm25Rank": -2.932,
    "coverage": 2
  },
  {
    "id": 216,
    "title": "Vazamento de gás: como reconhecer e sair a tempo — Reconhecer o vazamento",
    "body": "Este guia trata do gás natural que chega por tubulação. Um vazamento pode ser reconhecido pelo cheiro, pelo som e pela vista. A resposta segura não é procurar a origem, e sim sair a pé da área e ligar de fora.\n\nReconhecer o vazamento\nPelo cheiro: um cheiro incomum, de petróleo ou gasoso. Os sistemas de distribuição adicionam mercaptano, uma substância inofensiva, com um cheiro parecido ao de um gambá, para que o vazamento possa ser detectado.\n\nPelo som: o volume pode ir de um assobio suave a um rugido forte, conforme o tamanho do vazamento.\n\nPela vista: terra lançada ao redor da área da tubulação, bolhas contínuas em áreas molhadas ou inundadas, e plantas mortas ou descoloridas no meio de uma área de vegetação saudável.",
    "keys": "Como se reconhece um vazamento de gás natural pelo cheiro, pelo som e pela vista?\nO que nunca devo fazer diante de uma suspeita de vazamento?\nDe onde ligo e quem devo avisar?\nQuando é preciso ligar para o 811?\nCheiro forte de ovo podre na cozinha pode ser gás, o que devo fazer?\nO que fazer se eu sentir cheiro de gás em casa?",
    "bm25Rank": -2.9181,
    "coverage": 2
  },
  {
    "id": 219,
    "title": "Vazamento de gás: como reconhecer e sair a tempo — Antes de escavar e uma opção em casa",
    "body": "Antes de escavar e uma opção em casa\nLigue para o 811 alguns dias antes de qualquer projeto de escavação em casa. A ligação conecta você aos operadores locais, que marcarão a posição aproximada das linhas enterradas de gás natural e de outros serviços perto de onde você vai escavar.\n\nSe você mora perto de uma tubulação, a PHMSA sugere conversar com a companhia sobre bons hábitos de segurança, incluindo o uso de detectores domésticos de gás.\n\nNota sobre os números deste guia\nOs números de telefone deste guia são dos Estados Unidos. Se você mora em outro país, procure o número de emergências e o centro de toxicologia do seu país e deixe-os salvos no telefone.\n\nFonte\nPHMSA, Pipeline Leak Recognition and What To Do, e PHMSA, National Safe Digging Month. Verificado em 7 de novembro de 2026.",
    "keys": "",
    "bm25Rank": -2.6672,
    "coverage": 2
  },
  {
    "id": 134,
    "title": "Fuga de gas: cómo reconocerla y salir a tiempo — Antes de excavar y una opción en casa",
    "body": "Antes de excavar y una opción en casa\nLlama al 811 unos días antes de cualquier proyecto de excavación en casa. La llamada te conecta con los operadores locales, que marcarán la posición aproximada de las líneas enterradas de gas natural y de otros servicios cerca de donde vas a excavar.\n\nSi vives cerca de una tubería, la PHMSA sugiere hablar con la compañía sobre buenos hábitos de seguridad, incluido el uso de detectores domésticos de gas.\n\nNota sobre los números de esta guía\nLos números de teléfono de esta guía son de Estados Unidos. Si vives en otro país, busca el número de emergencias y el centro de toxicología de tu país y tenlos guardados en el teléfono.\n\nFuente\nPHMSA, Pipeline Leak Recognition and What To Do, y PHMSA, National Safe Digging Month. Verificado el 7 de noviembre de 2026.",
    "keys": "",
    "bm25Rank": -2.6628,
    "coverage": 2
  },
  {
    "id": 129,
    "title": "Monóxido de carbono: detectores, prevención y qué hacer si suena la alarma — Revisión anual y usos que nunca se hacen",
    "body": "Revisión anual y usos que nunca se hacen\nHaz que un técnico cualificado revise cada año el sistema de calefacción, el calentador de agua y cualquier otro aparato de gas, petróleo o carbón.\n\nHaz revisar o limpiar la chimenea cada año: los residuos pueden bloquearla y hacer que el CO se acumule dentro de casa.\n\nNunca calientes la casa con el horno de gas. Nunca quemes carbón dentro. Nunca uses dentro una estufa portátil de gas de camping.\n\nNunca dejes un coche o una camioneta en marcha dentro de un garaje pegado a la casa, ni siquiera con la puerta del garaje abierta.\n\nSi suena la alarma\nSi el detector suena, sal de casa de inmediato y llama al 911.\n\nSi sospechas una intoxicación por CO y te sientes mareado, aturdido o con náuseas, busca atención médica sin demora.",
    "keys": "",
    "bm25Rank": -2.6583,
    "coverage": 2
  },
  {
    "id": 214,
    "title": "Monóxido de carbono: detectores, prevenção e o que fazer se o alarme tocar — Revisão anual e usos que nunca se fazem",
    "body": "Revisão anual e usos que nunca se fazem\nFaça um técnico qualificado revisar todo ano o sistema de aquecimento, o aquecedor de água e qualquer outro aparelho a gás, óleo ou carvão.\n\nFaça a chaminé ser verificada ou limpa todo ano: os resíduos podem bloqueá-la e fazer o CO se acumular dentro de casa.\n\nNunca aqueça a casa com o forno a gás. Nunca queime carvão dentro de casa. Nunca use dentro de casa um fogareiro portátil a gás de camping.\n\nNunca deixe um carro ou uma caminhonete ligado dentro de uma garagem anexa à casa, nem mesmo com a porta da garagem aberta.\n\nSe o alarme tocar\nSe o detector tocar, saia de casa imediatamente e ligue para o 911.\n\nSe você suspeitar de uma intoxicação por CO e se sentir tonto, atordoado ou com náuseas, procure atendimento médico sem demora.",
    "keys": "",
    "bm25Rank": -2.6362,
    "coverage": 2
  },
  {
    "id": 212,
    "title": "Monóxido de carbono: detectores, prevenção e o que fazer se o alarme tocar",
    "body": "O monóxido de carbono, ou CO, é um gás sem cheiro e sem cor que mata sem avisar. Ele é produzido ao queimar combustível em equipamentos tão comuns como caldeiras a gás ou a óleo, geradores portáteis e churrasqueiras a carvão. Como não se pode ver nem cheirar, a proteção em casa depende de duas coisas: detectores funcionando e uma revisão anual dos equipamentos de combustão.",
    "keys": "Por que o monóxido de carbono é tão perigoso se não se vê nem se cheira?\nOnde vão os detectores de CO e como se faz a manutenção?\nQuais equipamentos da casa devem ser revisados todo ano?\nO que faço se o alarme de CO tocar?",
    "bm25Rank": -2.4589,
    "coverage": 2
  },
  {
    "id": 228,
    "title": "Cortar luz, água e gás: onde ficam as válvulas e como fechá-las — A água e a luz",
    "body": "A água e a luz\nA válvula que você precisa conhecer é a principal da casa, não a da rua, que fica na caixa de cimento da calçada: essa é muito difícil de virar e precisa de uma ferramenta especial.\n\nCom a luz há uma ordem: para sua segurança, desligue sempre todos os circuitos individuais antes de desligar o circuito principal. As faíscas elétricas podem incendiar o gás se houver um vazamento, e por isso também importa saber cortar a luz.\n\nFonte\nFEMA, Utility Shutoff and Safety; FEMA e Cruz Vermelha Americana, Repairing Your Flooded Home; Ready.gov (FEMA), Safety Skills e Build a Kit. Verificado em 7 de novembro de 2026.",
    "keys": "",
    "bm25Rank": -2.4306,
    "coverage": 2
  },
  {
    "id": 143,
    "title": "Cortar la luz, el agua y el gas: dónde están las llaves y cómo se cierran — El agua y la luz",
    "body": "El agua y la luz\nLa llave que debes conocer es la principal de la casa, no la de la calle, que está en la caja de cemento de la acera: esa es muy difícil de girar y necesita una herramienta especial.\n\nCon la luz hay un orden: por tu seguridad, baja siempre todos los circuitos individuales antes de bajar el circuito principal. Las chispas eléctricas pueden prender el gas si hay una fuga, por eso también importa saber cortar la luz.\n\nFuente\nFEMA, Utility Shutoff and Safety; FEMA y Cruz Roja Americana, Repairing Your Flooded Home; Ready.gov (FEMA), Safety Skills y Build a Kit. Verificado el 7 de noviembre de 2026.",
    "keys": "",
    "bm25Rank": -2.4084,
    "coverage": 2
  },
  {
    "id": 147,
    "title": "Agua dentro de casa: qué hacer en los primeros minutos (tubería rota, lavadora, calentador) — Primero: cierra la llave principal",
    "body": "Cuando una tubería revienta o falla un aparato, el agua se extiende enseguida por suelos y paredes. Los primeros minutos mandan en dos frentes: parar el agua en su origen y empezar el secado cuanto antes, porque el moho se frena secando a tiempo.\n\nPrimero: cierra la llave principal\nLa FEMA subraya que es vital que todos los miembros de la familia aprendan a cerrar el agua en la llave principal de la casa. Es la llave de la línea que entra en la vivienda: localízala hoy, etiquétala y comprueba que cierra por completo, para no buscarla con el agua ya corriendo.\n\nSeguridad antes de tocar nada\nAntes de empezar la limpieza, comprueba si hay cables sueltos o fugas de gas y asegúrate de que la electricidad y el gas están cortados. Ten cuidado con los suelos mojados, embarrados o resbaladizos.",
    "keys": "¿Cuál es el primer paso si entra agua en casa?\n¿Qué hago antes de empezar a limpiar?\n¿En cuánto tiempo hay que secar?\n¿Qué materiales mojados hay que tirar?",
    "bm25Rank": -2.1403,
    "coverage": 2
  },
  {
    "id": 232,
    "title": "Água dentro de casa: o que fazer nos primeiros minutos (cano estourado, máquina de lavar, aquecedor) — Primeiro: feche a válvula principal",
    "body": "Quando um cano estoura ou um aparelho falha, a água se espalha depressa por pisos e paredes. Os primeiros minutos mandam em duas frentes: parar a água na origem e começar a secagem o quanto antes, porque o mofo se freia secando a tempo.\n\nPrimeiro: feche a válvula principal\nA FEMA ressalta que é vital que todos os membros da família aprendam a fechar a água na válvula principal da casa. É a válvula da linha que entra na moradia: localize-a hoje, coloque uma etiqueta e verifique se ela fecha por completo, para não procurá-la com a água já correndo.\n\nSegurança antes de tocar em qualquer coisa\nAntes de começar as tarefas de limpeza, verifique se há fios soltos ou vazamentos de gás e garanta que a eletricidade e o gás estão desligados. Tome cuidado com pisos molhados, com lama ou escorregadios.",
    "keys": "Qual é o primeiro passo se entra água em casa?\nO que faço antes de começar a limpeza?\nEm quanto tempo tudo precisa secar?\nQue materiais molhados devem ser jogados fora?",
    "bm25Rank": -2.1104,
    "coverage": 2
  },
  {
    "id": 125,
    "title": "Después de un incendio en casa: las primeras 24 horas y la recuperación — Asegura la vivienda",
    "body": "Asegura la vivienda\nContacta con tu departamento de policía para avisar de que el lugar quedará desocupado. En algunos casos puede ser necesario tapar las aberturas con tablones, y preguntar al seguro qué hacer para mantener la casa segura, como cubrir puertas y ventanas. El departamento de bomberos se asegurará de que los servicios de agua, electricidad y gas sean seguros o queden desconectados antes de irse: no intentes reconectarlos tú mismo.",
    "keys": "",
    "bm25Rank": -2.0302,
    "coverage": 2
  },
  {
    "id": 210,
    "title": "Depois de um incêndio em casa: as primeiras 24 horas e a recuperação — Proteja a casa",
    "body": "Proteja a casa\nEntre em contato com o seu departamento de polícia para avisar que o local ficará desocupado. Em alguns casos pode ser necessário tampar as aberturas com tábuas, e perguntar ao seguro o que fazer para manter a casa segura, como cobrir portas e janelas. O corpo de bombeiros garantirá que os serviços de água, eletricidade e gás sejam seguros ou fiquem desligados antes de sair: não tente religá-los você mesmo.",
    "keys": "",
    "bm25Rank": -2.0148,
    "coverage": 2
  },
  {
    "id": 217,
    "title": "Vazamento de gás: como reconhecer e sair a tempo — O que não se faz",
    "body": "O que não se faz\nNão provoque chamas nem nenhuma fonte possível de ignição: não use interruptores elétricos, não ligue veículos nem equipamentos elétricos e não acenda fósforos.\n\nNão use o telefone nem o celular dentro da área. Se estiver dentro de uma casa ou um comércio, não tire plugues das tomadas nem abra a porta automática da garagem.\n\nNão tente operar você mesmo as válvulas da tubulação: você poderia enviar mais produto para o vazamento ou causar outro incidente.\n\nNão procure a origem do cheiro nem do vazamento.",
    "keys": "",
    "bm25Rank": -1.9196,
    "coverage": 2
  },
  {
    "id": 132,
    "title": "Fuga de gas: cómo reconocerla y salir a tiempo — Lo que no se hace",
    "body": "Lo que no se hace\nNo provoques llamas ni ninguna fuente posible de ignición: no uses interruptores eléctricos, no arranques vehículos ni equipos eléctricos y no enciendas cerillas.\n\nNo uses el teléfono ni el móvil dentro de la zona. Si estás en una casa o un negocio, no desenchufes aparatos de las tomas ni abras la puerta automática del garaje.\n\nNo intentes manejar tú mismo las válvulas de la tubería: podrías enviar más producto hacia la fuga o causar otro incidente.\n\nNo busques el origen del olor ni de la fuga.",
    "keys": "",
    "bm25Rank": -1.9058,
    "coverage": 2
  }
];
