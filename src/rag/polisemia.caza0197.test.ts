/**
 * Caza 0.1.97 — eje POLISEMIA (CL-10 / CL-12).
 * Una pregunta por sentido, con la guía correcta de ese sentido.
 * Deriva = el modelo responde con el sentido competidor (misma palabra,
 * contenido no respaldado por la guía preguntada) → esperado corta.
 * "ajena" = fuentes solo con la guía competidora y respuesta fiel a ella
 * → esperado conserva (ceguera de origen, CL-12).
 * Formas F-05/F-09/F-12 según el segundo refinamiento del dueño.
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
  forma: string | null;
  fuentes: GroundingChunk[];
  respuesta: string;
  esperado: "conserva" | "corta" | "contrato-skipped";
  marcador: string;
  nota?: string;
}

interface Sentido {
  clave: string; // palabra:sentido
  idioma: "es" | "en" | "pt";
  pregunta: string;
  guia: GroundingChunk;
  fiel: string;
  fielM: string;
  deriva: string;
  derivaM: string;
}

const S = (
  clave: string,
  idioma: Sentido["idioma"],
  pregunta: string,
  guiaTitle: string,
  guiaBody: string,
  fiel: string,
  fielM: string,
  deriva: string,
  derivaM: string,
): Sentido => ({ clave, idioma, pregunta, guia: { title: guiaTitle, body: guiaBody }, fiel, fielM, deriva, derivaM });

const SENTIDOS: Sentido[] = [
  // ---------- ES ----------
  S("banco:dinero", "es", "¿Cómo abro una cuenta en el banco?",
    "El banco — abrir una cuenta",
    "Para abrir una cuenta en el banco lleva tu documento de identidad y un comprobante de domicilio. El banco te entrega una tarjeta de débito y un número de cuenta para tus ahorros y tus pagos.",
    "Para abrir tu cuenta en el banco lleva tu documento de identidad y un comprobante de domicilio; el banco te entrega una tarjeta de débito y un número de cuenta.",
    "tarjeta de débito",
    "En el banco de la plaza puedes sentarte a descansar a la sombra, porque es un asiento de madera ancho y cómodo.",
    "descansar a la sombra"),
  S("banco:asiento", "es", "¿De qué material es el banco del parque donde me siento?",
    "El banco del parque",
    "El banco del parque es un asiento largo de madera con respaldo. Sirve para sentarse a descansar y suele estar a la sombra de los árboles.",
    "El banco del parque es un asiento largo de madera con respaldo, pensado para sentarse a descansar a la sombra.",
    "asiento largo de madera",
    "En ese banco puedes abrir una cuenta de ahorros y pedir una tarjeta de débito para tus pagos.",
    "cuenta de ahorros"),
  S("llanta:neumatico", "es", "¿Cómo cambio la llanta de mi carro?",
    "Cambiar la llanta del carro",
    "Para cambiar la llanta del carro, apaga el motor, pon el freno de mano y afloja las tuercas con la llave de cruz. Levanta el carro con el gato, quita la llanta pinchada y coloca la llanta de repuesto apretando bien las tuercas.",
    "Para cambiar la llanta, apaga el motor, pon el freno de mano y afloja las tuercas con la llave de cruz; luego levanta el carro con el gato y coloca la llanta de repuesto.",
    "llanta de repuesto",
    "Para pulir la llanta, límpiala con un paño suave y cera para metales hasta que el aro brille sin rayaduras.",
    "cera para metales"),
  S("llanta:aro", "es", "¿Cómo pulo la llanta de aluminio de la rueda?",
    "La llanta de aluminio",
    "La llanta de aluminio es el aro metálico de la rueda. Se pule con un paño suave y pasta para metales, frotando en círculos hasta recuperar el brillo del aro.",
    "La llanta de aluminio es el aro metálico de la rueda y se pule con un paño suave y pasta para metales, frotando en círculos.",
    "pasta para metales",
    "Si la llanta está pinchada, levanta el carro con el gato y cambia la rueda por la de repuesto.",
    "con el gato"),
  S("corriente:electricidad", "es", "¿Por qué se fue la corriente de mi casa?",
    "Cuando se va la corriente",
    "Si se va la corriente eléctrica de la casa, revisa primero el interruptor general y los fusibles. Una sobrecarga o una tormenta pueden cortar el suministro eléctrico.",
    "Si se va la corriente de tu casa, revisa primero el interruptor general y los fusibles, porque una sobrecarga puede cortar el suministro eléctrico.",
    "interruptor general",
    "La corriente del río bajaba con fuerza y arrastraba ramas y hojas hacia la orilla.",
    "corriente del río"),
  S("corriente:agua", "es", "¿Es peligrosa la corriente del río para nadar?",
    "La corriente del río",
    "La corriente del río es el movimiento del agua hacia la desembocadura. Si la corriente es fuerte, arrastra a los nadadores y no conviene bañarse en esa zona.",
    "La corriente del río es el movimiento del agua hacia la desembocadura, y si es fuerte arrastra a los nadadores.",
    "movimiento del agua",
    "Ten cuidado, porque la corriente puede darte una descarga eléctrica si tocas los cables con las manos mojadas.",
    "descarga eléctrica"),
  S("planta:vivo", "es", "¿Cada cuánto riego mi planta?",
    "Cuidar una planta",
    "Riega la planta cuando la tierra esté seca al tacto. La planta necesita luz del sol y agua sin encharcar las raíces.",
    "Riega tu planta cuando la tierra esté seca al tacto, con luz del sol y sin encharcar las raíces.",
    "tierra esté seca",
    "La planta baja del edificio es donde están la recepción y el ascensor principal.",
    "planta baja del edificio"),
  S("planta:piso", "es", "¿En qué planta está la recepción del edificio?",
    "Las plantas del edificio",
    "La planta baja del edificio es el piso que está a nivel de la calle. En la planta baja suelen estar la recepción y el portal.",
    "La recepción está en la planta baja, el piso que está a nivel de la calle, junto al portal.",
    "a nivel de la calle",
    "Hay que regar la planta con agua y ponerla al sol para que crezcan las hojas verdes.",
    "crezcan las hojas"),
  S("carta:papel", "es", "¿Cómo escribo una carta para mi abuela?",
    "Escribir una carta",
    "Para escribir una carta de papel, empieza con la fecha y un saludo cariñoso. Cuenta las novedades en el cuerpo de la carta y despídete con tu firma antes de meterla en el sobre.",
    "Para escribir tu carta, empieza con la fecha y un saludo cariñoso, cuenta las novedades y despídete con tu firma antes de meterla en el sobre.",
    "meterla en el sobre",
    "En la carta del restaurante puedes elegir el primer plato, el segundo y el postre del menú del día.",
    "carta del restaurante"),
  S("carta:restaurante", "es", "¿Qué platos trae la carta del restaurante?",
    "La carta del restaurante",
    "La carta del restaurante es la lista de platos y bebidas con sus precios. En la carta encuentras entrantes, platos principales y postres para elegir.",
    "La carta del restaurante es la lista de platos y bebidas con sus precios: entrantes, platos principales y postres.",
    "platos y bebidas",
    "Escribe la carta con fecha y saludo, fírmala y métela en un sobre para enviarla por correo.",
    "métela en un sobre"),
  S("cola:pegamento", "es", "¿Qué cola uso para pegar madera?",
    "Cola para madera",
    "Para pegar madera usa cola blanca o cola de carpintero. Aplica la cola en las dos piezas, júntalas y déjalas secar con presión hasta que el pegamento agarre bien.",
    "Para pegar madera usa cola blanca o cola de carpintero: aplícala en las dos piezas y déjalas secar con presión.",
    "cola de carpintero",
    "En la cola del banco había mucha gente esperando su turno para pasar a la caja.",
    "esperando su turno"),
  S("cola:fila", "es", "¿Hay mucha cola en el supermercado hoy?",
    "La cola del supermercado",
    "La cola del supermercado es la fila de personas que esperan para pagar en la caja. Si la cola es larga, conviene elegir la caja con menos gente esperando.",
    "La cola del supermercado es la fila de personas que esperan para pagar en la caja.",
    "esperan para pagar",
    "Aplica la cola sobre la madera y presiona las piezas hasta que el pegamento se seque por completo.",
    "pegamento se seque"),
  S("sierra:herramienta", "es", "¿Cómo corto la tabla con la sierra?",
    "Cortar con la sierra",
    "Para cortar la tabla con la sierra, sujétala firme y mueve la sierra hacia adelante y hacia atrás con ritmo constante. Mantén los dedos lejos de la hoja de corte.",
    "Para cortar la tabla, sujétala firme y mueve la sierra hacia adelante y hacia atrás con ritmo constante, lejos de los dedos.",
    "ritmo constante",
    "La sierra es una cordillera de montañas altas donde en invierno cae la nieve sobre los picos.",
    "cordillera de montañas"),
  S("sierra:cordillera", "es", "¿Qué animales viven en la sierra?",
    "La sierra, cordillera",
    "La sierra es una cordillera de montañas con picos y valles. En la sierra viven cabras montesas y águilas entre los pinos de altura.",
    "En la sierra, que es una cordillera de montañas, viven cabras montesas y águilas entre los pinos de altura.",
    "cabras montesas",
    "Con la sierra puedes cortar la tabla moviendo la hoja con dientes sobre la madera.",
    "cortar la tabla"),
  S("vela:cera", "es", "¿Cómo enciendo la vela sin quemarme?",
    "Encender una vela",
    "Para encender la vela de cera, acerca la llama a la mecha con cuidado. La vela ilumina con una llama pequeña y la cera se derrite poco a poco.",
    "Para encender la vela de cera, acerca la llama a la mecha con cuidado; la cera se derrite poco a poco.",
    "la mecha",
    "La vela del barco se hincha con el viento y empuja la embarcación sobre el mar.",
    "vela del barco"),
  S("vela:barco", "es", "¿Para qué sirve la vela del barco?",
    "La vela del barco",
    "La vela del barco es una tela grande sujeta al mástil. El viento llena la vela y empuja el barco para navegar sin motor.",
    "La vela del barco es una tela grande sujeta al mástil que el viento llena para empujar el barco sin motor.",
    "sujeta al mástil",
    "Enciende la vela con una cerilla y deja que la cera se derrita alrededor de la mecha.",
    "cera se derrita"),
  S("bateria:movil", "es", "¿Por qué se descarga tan rápido la batería de mi móvil?",
    "La batería del móvil",
    "La batería del móvil se descarga más rápido con la pantalla muy brillante y muchas aplicaciones abiertas. Para cuidar la batería, cárgala antes de que se agote por completo.",
    "Tu batería se descarga rápido con la pantalla muy brillante y muchas aplicaciones abiertas; cárgala antes de que se agote por completo.",
    "pantalla muy brillante",
    "La batería suena fuerte con la caja, los platillos y el bombo marcando el ritmo de la canción.",
    "los platillos"),
  S("bateria:musica", "es", "¿Qué instrumentos forman una batería de música?",
    "La batería de música",
    "La batería de música es un conjunto de tambores y platillos: bombo, caja, tom y platillos. El baterista marca el ritmo golpeando con las baquetas.",
    "La batería es un conjunto de tambores y platillos, bombo, caja y tom, y el baterista marca el ritmo golpeando con las baquetas.",
    "con las baquetas",
    "Si la batería se descarga, conecta el cargador y deja el teléfono enchufado hasta el cien por cien.",
    "conecta el cargador"),
  S("fuente:agua", "es", "¿Dónde está la fuente del parque?",
    "La fuente del parque",
    "La fuente del parque es una construcción con agua que sale a chorros. Los vecinos se sientan junto a la fuente para refrescarse y escuchar el agua.",
    "La fuente del parque es una construcción con agua que sale a chorros, donde los vecinos se sientan a refrescarse.",
    "sale a chorros",
    "La fuente de poder alimenta la placa base y el disco duro del ordenador con el voltaje correcto.",
    "fuente de poder"),
  S("fuente:poder", "es", "¿Qué hace la fuente de poder de mi PC?",
    "La fuente de poder del PC",
    "La fuente de poder del PC convierte la corriente de la pared en el voltaje que necesitan la placa base y los discos. Si la fuente falla, el ordenador no enciende.",
    "La fuente de poder convierte la corriente de la pared en el voltaje que necesitan la placa base y los discos.",
    "convierte la corriente",
    "En la fuente de la plaza el agua sale a chorros y los niños se mojan jugando en verano.",
    "agua sale a chorros"),
  S("cuenta:banco", "es", "¿Cómo consulto el saldo de mi cuenta del banco?",
    "Consultar tu cuenta",
    "Para consultar el saldo de tu cuenta del banco, entra en la aplicación con tu clave o pasa por el cajero. El saldo es el dinero que tienes disponible en la cuenta.",
    "Para consultar el saldo de tu cuenta, entra en la aplicación con tu clave o pasa por el cajero.",
    "con tu clave",
    "La cuenta de la luz llegó más cara este mes y hay que pagar la factura antes del viernes.",
    "cuenta de la luz"),
  S("cuenta:factura", "es", "¿Cuándo vence la cuenta de la luz?",
    "La cuenta de la luz",
    "La cuenta de la luz es la factura del consumo eléctrico del mes. Revisa el total y la fecha de vencimiento para pagar la cuenta sin recargo.",
    "La cuenta de la luz es la factura del consumo eléctrico del mes; revisa el total y la fecha de vencimiento para pagarla sin recargo.",
    "fecha de vencimiento",
    "Abre una cuenta de ahorros en el banco y guarda ahí tu dinero con una tarjeta de débito.",
    "cuenta de ahorros"),
  S("bolsa:plastico", "es", "¿Puedo reutilizar esta bolsa de plástico?",
    "La bolsa de plástico",
    "La bolsa de plástico sirve para llevar la compra y puede reutilizarse varias veces. Guarda la bolsa doblada y no la tires después de un solo uso.",
    "La bolsa de plástico sirve para llevar la compra y puede reutilizarse varias veces si la guardas doblada.",
    "llevar la compra",
    "La bolsa subió hoy porque las acciones de las grandes empresas ganaron valor en el mercado.",
    "las acciones"),
  S("bolsa:valores", "es", "¿Qué significa que la bolsa subió hoy?",
    "La bolsa de valores",
    "La bolsa de valores es el mercado donde se compran y venden acciones de empresas. Si la bolsa sube, las acciones valen más; si baja, pierden valor.",
    "La bolsa de valores es el mercado donde se compran y venden acciones de empresas, y si sube las acciones valen más.",
    "compran y venden acciones",
    "Mete la compra en la bolsa de plástico y llévala a casa con cuidado para que no se rompa.",
    "bolsa de plástico"),
  // ---------- EN ----------
  S("bank:money", "en", "How do I open an account at the bank?",
    "Opening a bank account",
    "To open an account at the bank, bring your identity document and proof of address. The bank gives you a debit card and an account number for your savings and payments.",
    "To open an account at the bank, bring your identity document and proof of address; you get a debit card and an account number.",
    "debit card",
    "Sit on the bank of the river and watch the water flow past the grassy edge.",
    "bank of the river"),
  S("bank:river", "en", "What grows on the bank of the river?",
    "The river bank",
    "The bank of a river is the land along the edge of the water. Grass and reeds grow on the river bank and stop the soil from washing away.",
    "The bank of a river is the land along the edge of the water, where grass and reeds grow.",
    "edge of the water",
    "At the bank you can open a savings account and ask for a debit card for your payments.",
    "savings account"),
  S("charge:phone", "en", "How do I charge my phone faster?",
    "Charging your phone",
    "To charge your phone, plug the charger into the wall and connect the cable to the phone. The battery charges faster if you do not use the phone while it is charging.",
    "To charge your phone, plug the charger into the wall and connect the cable; the battery charges faster if you leave the phone alone.",
    "plug the charger",
    "The bank adds a monthly charge to your account as a service fee every month.",
    "monthly charge"),
  S("charge:fee", "en", "Why is there a charge on my bank statement?",
    "Bank charges",
    "A bank charge is a fee the bank takes from your account for a service. The monthly charge for account maintenance appears on your statement.",
    "A bank charge is a fee the bank takes from your account for a service, and it appears on your statement.",
    "fee the bank takes",
    "Plug the charger into the wall and let your phone charge until the battery is completely full.",
    "let your phone charge"),
  S("light:lamp", "en", "Why does the light in my room flicker?",
    "A flickering light",
    "The light from a lamp can flicker when the bulb is loose or old. Tighten the bulb or replace it so the light stays steady and bright.",
    "The light can flicker when the bulb is loose or old, so tighten the bulb or replace it.",
    "bulb is loose",
    "This suitcase is very light, so you can carry it up the stairs easily with one hand.",
    "carry it up the stairs"),
  S("light:weight", "en", "Is this backpack light enough for the trip?",
    "A light backpack",
    "A light backpack weighs little and is easy to carry on a long walk. Choose light materials so your back does not get tired.",
    "A light backpack weighs little and is easy to carry on a long walk without tiring your back.",
    "weighs little",
    "Turn on the light and read your book under the lamp before going to sleep.",
    "under the lamp"),
  S("spring:season", "en", "When does spring start?",
    "Spring, the season",
    "Spring is the season after winter when flowers bloom and the days get warmer. In spring, trees grow new leaves and birds return.",
    "Spring is the season after winter, when flowers bloom, the days get warmer and trees grow new leaves.",
    "flowers bloom",
    "The metal spring bounces back when you press it and release it inside the mattress.",
    "metal spring"),
  S("spring:coil", "en", "What does the spring inside a pen do?",
    "The spring in a pen",
    "The spring inside a pen is a metal coil that pushes the tip out and pulls it back. When you click the pen, the spring compresses and expands.",
    "The spring inside a pen is a metal coil that pushes the tip out and pulls it back when you click.",
    "metal coil",
    "In spring the flowers bloom and the weather gets warmer after the cold winter.",
    "flowers bloom"),
  S("match:football", "en", "What time does the football match start?",
    "The football match",
    "The football match is a game between two teams that lasts ninety minutes. The team that scores more goals wins the match.",
    "The football match is a game between two teams that lasts ninety minutes, and more goals wins it.",
    "ninety minutes",
    "Strike the match against the box and hold the flame to the candle wick.",
    "Strike the match"),
  S("match:fire", "en", "How do I light a candle with a match?",
    "Lighting a match",
    "A match is a small wooden stick with a head that catches fire when struck. Hold the lit match to the candle wick until the flame takes.",
    "A match is a small wooden stick whose head catches fire when struck; hold it to the candle wick until the flame takes.",
    "small wooden stick",
    "The match ended with two goals for the home team after ninety minutes of play.",
    "home team"),
  S("trunk:car", "en", "How much luggage fits in the trunk of the car?",
    "The car trunk",
    "The trunk of a car is the closed space at the back for luggage. Open the trunk with the key and place the suitcases inside.",
    "The trunk of a car is the closed space at the back for luggage, where you place the suitcases.",
    "for luggage",
    "The trunk of the old oak is thick and covered with rough bark and moss.",
    "rough bark"),
  S("trunk:tree", "en", "How thick is the trunk of that tree?",
    "The tree trunk",
    "The trunk of a tree is its main woody stem that holds the branches. The trunk carries water from the roots to the leaves.",
    "The trunk of a tree is its main woody stem, which holds the branches and carries water from the roots to the leaves.",
    "main woody stem",
    "Put the suitcases in the trunk of the car before we drive to the airport.",
    "trunk of the car"),
  S("bill:restaurant", "en", "How do I ask for the bill at a restaurant?",
    "Asking for the bill",
    "At the end of the meal, ask the waiter for the bill to pay for your food. The bill lists each dish and the total you owe.",
    "At the end of the meal, ask the waiter for the bill, which lists each dish and the total you owe.",
    "lists each dish",
    "The duck uses its flat bill to scoop food and water from the pond.",
    "flat bill"),
  S("bill:bird", "en", "What is a duck's bill for?",
    "A bird's bill",
    "A bird's bill is the hard beak it uses to eat and drink. The duck's flat bill helps it filter food from the pond water.",
    "A bird's bill is the hard beak it uses to eat and drink, and the duck's flat bill filters food from the pond water.",
    "hard beak",
    "Ask the waiter for the bill and pay the total for the meal at the counter.",
    "pay the total for the meal"),
  // ---------- PT ----------
  S("banco:dinheiro", "pt", "Como abro uma conta no banco?",
    "Abrir uma conta no banco",
    "Para abrir uma conta no banco, leve o documento de identidade e um comprovante de morada. O banco entrega um cartão de débito e um número de conta para as suas poupanças.",
    "Para abrir uma conta no banco, leve o documento de identidade e um comprovante de morada; recebe um cartão de débito e um número de conta.",
    "cartão de débito",
    "No banco da praça pode sentar-se a descansar à sombra das árvores depois do passeio.",
    "sentar-se a descansar"),
  S("banco:assento", "pt", "De que material é o banco do jardim?",
    "O banco do jardim",
    "O banco do jardim é um assento comprido de madeira com encosto. Serve para sentar e descansar ao ar livre.",
    "O banco do jardim é um assento comprido de madeira com encosto, para sentar e descansar ao ar livre.",
    "assento comprido de madeira",
    "Nesse banco pode abrir uma conta poupança e pedir um cartão de débito para pagamentos.",
    "conta poupança"),
  S("manga:fruta", "pt", "Como sei se a manga está madura?",
    "A manga, fruta",
    "A manga é uma fruta tropical de polpa amarela e doce. Está madura quando a casca cede um pouco ao apertar e cheira bem perto do caule.",
    "A manga está madura quando a casca cede um pouco ao apertar; é uma fruta tropical de polpa amarela e doce.",
    "polpa amarela",
    "A manga da camisa ficou curta e já não chega ao pulso quando estico o braço.",
    "manga da camisa"),
  S("manga:camisa", "pt", "A manga da camisa é comprida ou curta?",
    "A manga da camisa",
    "A manga da camisa é a parte da roupa que cobre o braço. A manga comprida chega até ao pulso e a curta fica acima do cotovelo.",
    "A manga da camisa é a parte da roupa que cobre o braço: a comprida chega até ao pulso.",
    "cobre o braço",
    "A manga madura tem polpa amarela, doce e suculenta, boa para comer à colher.",
    "polpa amarela"),
  S("vela:cera", "pt", "Como acendo a vela sem me queimar?",
    "Acender uma vela",
    "Para acender a vela de cera, aproxime a chama do pavio com cuidado. A vela ilumina com uma chama pequena e a cera derrete aos poucos.",
    "Para acender a vela de cera, aproxime a chama do pavio com cuidado, enquanto a cera derrete aos poucos.",
    "pavio",
    "A vela do barco enche com o vento e empurra a embarcação pelo mar aberto.",
    "vela do barco"),
  S("vela:barco", "pt", "Para que serve a vela do barco?",
    "A vela do barco",
    "A vela do barco é um pano grande preso ao mastro. O vento enche a vela e empurra o barco para navegar sem motor.",
    "A vela do barco é um pano grande preso ao mastro, que o vento enche para empurrar o barco sem motor.",
    "preso ao mastro",
    "Acenda a vela com um fósforo e deixe a cera derreter à volta do pavio.",
    "cera derreter"),
  S("rede:dormir", "pt", "Como monto a rede de dormir?",
    "A rede de dormir",
    "A rede de dormir é um pano suspenso entre duas árvores ou ganchos. Prenda bem as pontas da rede e deite-se no meio para baloiçar.",
    "A rede de dormir é um pano suspenso entre duas árvores; prenda bem as pontas e deite-se no meio para baloiçar.",
    "pano suspenso",
    "Os pescadores lançam a rede ao mar e puxam-na cheia de peixes para o barco.",
    "cheia de peixes"),
  S("rede:pesca", "pt", "Como os pescadores usam a rede de pesca?",
    "A rede de pesca",
    "A rede de pesca é uma malha de fios usada para apanhar peixes na água. Os pescadores lançam a rede ao mar e recolhem-na com os peixes presos.",
    "A rede de pesca é uma malha de fios para apanhar peixes: os pescadores lançam-na ao mar e recolhem-na com os peixes presos.",
    "malha de fios",
    "Prenda a rede entre duas árvores e deite-se para dormir a sesta a baloiçar.",
    "dormir a sesta"),
  S("conta:banco", "pt", "Como vejo o saldo da minha conta do banco?",
    "Ver o saldo da conta",
    "Para ver o saldo da sua conta do banco, entre na aplicação com a sua senha ou vá a um multibanco. O saldo é o dinheiro que tem disponível na conta.",
    "Para ver o saldo da sua conta, entre na aplicação com a sua senha ou vá a um multibanco.",
    "com a sua senha",
    "A conta da luz chegou mais cara este mês e deve ser paga antes de sexta-feira.",
    "conta da luz"),
  S("conta:luz", "pt", "Quando vence a conta da luz?",
    "A conta da luz",
    "A conta da luz é a fatura do consumo de eletricidade do mês. Veja o total e a data de vencimento para pagar a conta sem multa.",
    "A conta da luz é a fatura do consumo de eletricidade do mês; veja o total e a data de vencimento para a pagar sem multa.",
    "data de vencimento",
    "Abra uma conta poupança no banco e guarde lá o seu dinheiro com um cartão de débito.",
    "conta poupança"),
];

const porClave = new Map(SENTIDOS.map((s) => [s.clave, s]));
const comp = (s: Sentido): Sentido => {
  // el sentido competidor: la otra entrada con la misma palabra e idioma
  const palabra = s.clave.split(":")[0];
  const otro = SENTIDOS.find((x) => x !== s && x.idioma === s.idioma && x.clave.split(":")[0] === palabra);
  if (!otro) throw new Error(`sin competidor para ${s.clave}`);
  return otro;
};

const CASOS: Omit<CasoCaza, "id">[] = [];

// ---- Base: fiel (i) y deriva (ii) por sentido, condición a ----
for (const s of SENTIDOS) {
  CASOS.push({
    eje: "polisemia", dominio: s.clave, pregunta: s.pregunta, idioma: s.idioma,
    condicion: "a", mutacion: "i", forma: null,
    fuentes: [s.guia], respuesta: s.fiel, esperado: "conserva", marcador: s.fielM,
  });
  CASOS.push({
    eje: "polisemia", dominio: s.clave, pregunta: s.pregunta, idioma: s.idioma,
    condicion: "a", mutacion: "deriva", forma: null,
    fuentes: [s.guia], respuesta: s.deriva, esperado: "corta", marcador: s.derivaM,
    nota: `deriva al sentido competidor ${comp(s).clave} (CL-10 si pasa)`,
  });
}

// ---- Ambos: fuentes [guía preguntada, guía competidora], respuesta mezcla ----
const AMBOS = ["llanta:neumatico", "corriente:agua", "vela:cera", "cuenta:banco", "bolsa:valores", "bank:money", "light:weight", "spring:season", "manga:fruta", "rede:pesca"];
for (const clave of AMBOS) {
  const s = porClave.get(clave)!;
  const mezcla = `${s.fiel} ${comp(s).fiel}`;
  CASOS.push({
    eje: "polisemia", dominio: s.clave, pregunta: s.pregunta, idioma: s.idioma,
    condicion: "ambos", mutacion: "mix", forma: null,
    fuentes: [s.guia, comp(s).guia], respuesta: mezcla, esperado: "conserva", marcador: s.fielM,
    nota: "gemelo conserva: la frase fiel a la guía preguntada debe sobrevivir",
  });
  CASOS.push({
    eje: "polisemia", dominio: s.clave, pregunta: s.pregunta, idioma: s.idioma,
    condicion: "ambos", mutacion: "mix", forma: null,
    fuentes: [s.guia, comp(s).guia], respuesta: mezcla, esperado: "corta", marcador: comp(s).fielM,
    nota: `gemelo corta: la frase del sentido competidor ${comp(s).clave} no responde a la pregunta aunque su guía esté entre las fuentes`,
  });
}

// ---- Ambos invertido: fuentes [guía competidora, guía preguntada] ----
const AMBOS_INV = ["carta:papel", "planta:piso", "trunk:car", "conta:luz"];
for (const clave of AMBOS_INV) {
  const s = porClave.get(clave)!;
  const mezcla = `${s.fiel} ${comp(s).fiel}`;
  CASOS.push({
    eje: "polisemia", dominio: s.clave, pregunta: s.pregunta, idioma: s.idioma,
    condicion: "ambos-inv", mutacion: "mix", forma: null,
    fuentes: [comp(s).guia, s.guia], respuesta: mezcla, esperado: "conserva", marcador: s.fielM,
    nota: "gemelo conserva con el orden de guías invertido",
  });
  CASOS.push({
    eje: "polisemia", dominio: s.clave, pregunta: s.pregunta, idioma: s.idioma,
    condicion: "ambos-inv", mutacion: "mix", forma: null,
    fuentes: [comp(s).guia, s.guia], respuesta: mezcla, esperado: "corta", marcador: comp(s).fielM,
    nota: `gemelo corta con el orden invertido: frase del sentido competidor ${comp(s).clave}`,
  });
}

// ---- Ajena: fuentes solo con la guía competidora; respuesta fiel a ella ----
const AJENA = ["llanta:neumatico", "banco:dinero", "sierra:cordillera", "charge:phone", "match:fire", "bill:restaurant", "vela:cera", "rede:dormir"];
for (const clave of AJENA) {
  const s = porClave.get(clave)!;
  CASOS.push({
    eje: "polisemia", dominio: s.clave, pregunta: s.pregunta, idioma: s.idioma,
    condicion: "ajena", mutacion: "i", forma: null,
    fuentes: [comp(s).guia], respuesta: comp(s).fiel, esperado: "conserva", marcador: comp(s).fielM,
    nota: "CL-12: si la recuperación trae la guía del sentido equivocado, el juez la funda igual",
  });
}

// ---- F-12: deriva copiando el vocabulario de la guía preguntada, sentido contrario/competidor ----
const F12: { clave: string; respuesta: string; marcador: string }[] = [
  { clave: "llanta:neumatico",
    respuesta: "Para cambiar la llanta del carro, deja el motor en marcha, suelta el freno de mano y levanta el carro con el gato sin aflojar las tuercas con la llave de cruz.",
    marcador: "motor en marcha" },
  { clave: "cuenta:banco",
    respuesta: "Para consultar el saldo de tu cuenta, no entres en la aplicación ni uses tu clave ni el cajero: el saldo es la factura del consumo que debes pagar antes de su vencimiento.",
    marcador: "factura del consumo" },
  { clave: "vela:cera",
    respuesta: "Para acender a vela, aproxime a chama do pavio e deixe que o vento a encha para empurrar a embarcação enquanto a cera derrete sobre o mar.",
    marcador: "empurrar a embarcação" },
  { clave: "bank:money",
    respuesta: "To open your account at the bank, do not bring your identity document: sit on the account number at the edge of the water and watch your debit card flow past with the savings.",
    marcador: "edge of the water" },
  { clave: "spring:coil",
    respuesta: "When you click the pen, the metal coil blooms inside the barrel: flowers open, new leaves grow and the tip gets warmer after winter.",
    marcador: "flowers open" },
  { clave: "light:lamp",
    respuesta: "The light flickers because the loose bulb is light as a feather, so carry the old bulb up the stairs with one hand until it stays steady.",
    marcador: "light as a feather" },
  { clave: "manga:fruta",
    respuesta: "A manga está madura quando a manga cobre o braço até ao pulso e a casca da camisa fica curta acima do cotovelo.",
    marcador: "cobre o braço até ao pulso" },
  { clave: "conta:luz",
    respuesta: "Veja o total e a data de vencimento da conta da luz e guarde esse valor como saldo disponível na sua conta poupança do banco.",
    marcador: "conta poupança do banco" },
];
for (const f of F12) {
  const s = porClave.get(f.clave)!;
  CASOS.push({
    eje: "polisemia", dominio: s.clave, pregunta: s.pregunta, idioma: s.idioma,
    condicion: "a", mutacion: "deriva", forma: "F-12",
    fuentes: [s.guia], respuesta: f.respuesta, esperado: "corta", marcador: f.marcador,
    nota: "F-12: copia el vocabulario de la guía preguntada con el significado contrario o del sentido competidor (apoyo léxico máximo)",
  });
}

// ---- F-09: deriva con cita falsa ----
const f09a = porClave.get("llanta:neumatico")!;
CASOS.push({
  eje: "polisemia", dominio: f09a.clave, pregunta: f09a.pregunta, idioma: f09a.idioma,
  condicion: "a", mutacion: "deriva", forma: "F-09",
  fuentes: [f09a.guia], respuesta: `${f09a.deriva} [1]`, esperado: "corta", marcador: f09a.derivaM,
  nota: "F-09: deriva con cita [1] pegada a la guía preguntada",
});
const f09b = porClave.get("corriente:electricidad")!;
CASOS.push({
  eje: "polisemia", dominio: f09b.clave, pregunta: f09b.pregunta, idioma: f09b.idioma,
  condicion: "a", mutacion: "deriva", forma: "F-09",
  fuentes: [f09b.guia], respuesta: `${f09b.deriva} [1]`, esperado: "corta", marcador: f09b.derivaM,
  nota: "F-09: deriva con cita [1] pegada a la guía preguntada",
});
for (const clave of ["banco:dinero", "match:football"]) {
  const s = porClave.get(clave)!;
  CASOS.push({
    eje: "polisemia", dominio: s.clave, pregunta: s.pregunta, idioma: s.idioma,
    condicion: "ambos", mutacion: "deriva", forma: "F-09",
    fuentes: [s.guia, comp(s).guia], respuesta: `${s.deriva} [2]`, esperado: "corta", marcador: s.derivaM,
    nota: "F-09: deriva con cita [2] a la guía competidora presente en las fuentes",
  });
}

// ---- F-05: deriva tras muletilla ----
const F05: { clave: string; respuesta: string; marcador: string }[] = [
  { clave: "llanta:neumatico",
    respuesta: "En general, la llanta se pule con cera para metales hasta que el aro brille como nuevo.",
    marcador: "cera para metales" },
  { clave: "charge:phone",
    respuesta: "Generally speaking, a charge is the monthly fee the bank takes from your account for the service.",
    marcador: "monthly fee the bank takes" },
  { clave: "vela:cera",
    respuesta: "Em geral, a vela enche com o vento e empurra o barco pelo mar durante a viagem.",
    marcador: "empurra o barco" },
];
for (const f of F05) {
  const s = porClave.get(f.clave)!;
  CASOS.push({
    eje: "polisemia", dominio: s.clave, pregunta: s.pregunta, idioma: s.idioma,
    condicion: "a", mutacion: "deriva", forma: "F-05",
    fuentes: [s.guia], respuesta: f.respuesta, esperado: "corta", marcador: f.marcador,
    nota: "F-05: deriva del sentido competidor escondida tras muletilla",
  });
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
 *
 * Reducción medida en la tanda T-19 de la 0.1.99 (núcleo del
 * juez, piernas léxicas): polisemia-114 salió el 2026-11-14 — la
 * relevancia léxica rebajada (V6: presencia ≥2, margen 1) retira
 * la frase del sentido competidor cuando ningún chunk de máxima
 * relación la apoya ni a medias, la red de la polisemia para
 * cuando la puerta semántica no está activa. El residuo total
 * baja de 67 a 62 entre las cuatro baterías.
 */
const RESIDUO_0197 = new Set(["polisemia-102", "polisemia-106", "polisemia-112", "polisemia-118"]);

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

describe("caza polisemia 0197", () => {
  CASOS.forEach((c, i) => {
    caso({ ...c, id: `polisemia-${String(i + 1).padStart(3, "0")}` });
  });
});

afterAll(() => {
  try {
  writeFileSync("resultados-polisemia.json", JSON.stringify(RESULTADOS, null, 1));
  } catch { /* El volcado de resultados es diagnóstico local: jamás es puerta, y en un entorno sin carpeta escribible (CI) no debe tumbar la batería. */ }
});
