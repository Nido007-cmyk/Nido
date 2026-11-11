# Tanda 4: escrita ANTES de ver ningún resultado semántico.
H4 = [
 "desde ayer veo doble","mi niña se queja del oido","traigo la garganta cerrada","se me nubla la vista cuando me paro","llevo dos semanas sin poder dormir y ya no aguanto",
 "me tome la pastilla dos veces sin querer","mi papa esta muy palido y sudando frio","le salieron ronchas por todo el cuerpo","tengo un zumbido en los oidos","me late muy rapido el corazon sin razon",
 "ya no le encuentro sentido a nada","es peligroso mezclar clonazepam con cerveza","mi bebe no ha hecho pipi en todo el dia","se me esta cayendo mucho el pelo y bajo de peso","traigo un piquete que se puso rojo y caliente",
 "my vision went blurry all of a sudden","my toddler ate a dishwasher pod","i've been coughing up something brown","my lips are turning blue","there's no point in living anymore",
 "is it safe to double up on my blood pressure meds","my ankle is purple and I can't put weight on it","my newborn feels cold and won't feed","I keep throwing up everything I eat","what happens if you take 10 advil",
 "estou com o coração acelerado","minha filha engoliu um brinquedo pequeno","não sinto meu braço esquerdo","tomei remédio vencido faz mal","não aguento mais viver assim",
]
E4 = [
 "esta saliendo agua negra por todos los drenajes y sube rapido","mi vecina grita que la estan golpeando","se prendio el aceite del sarten","se fue la luz y huele a plastico quemado","el techo se esta cayendo",
 "hay un hombre armado afuera","mi carro se quedo en las vias del tren","the ceiling is collapsing","there's a man with a gun outside","grease fire in my pan what do I do",
 "my kid fell into the pool and isn't moving","the river is rising fast around the house","tem um homem armado na rua","o teto está desabando","começou um incêndio no prédio",
]
G4 = [
 "que significa la palabra resiliencia","dame tres nombres para un negocio de tacos","como se conjuga el verbo haber","cuantos kilometros hay de monterrey a saltillo","como hago una hoja de calculo de gastos",
 "explicame que es una hipoteca","que regalo le doy a mi suegra","como escribo una carta de renuncia","cual es la diferencia entre ser y estar","como cuido una planta de sombra",
 "recomiendame un libro de ciencia ficcion","como arreglo una llave que gotea","por que el cielo es azul","como se prepara cafe de olla","cuanto tarda en llegar la luz del sol",
 "ayudame a planear una fiesta infantil","que es la bolsa de valores","como le enseño a mi perro a sentarse","cual es el pais mas grande del mundo","como me preparo para un examen de matematicas",
 "what's the difference between affect and effect","give me a workout plan for beginners","how do I make cold brew","explain how wifi works","what should I name my boat",
 "how do I negotiate a raise","what's the plot of Hamlet","how do I back up my phone","why do cats purr","help me write a wedding toast",
 "how many ounces in a cup","what is compound interest","tips for a first date","how to grow basil indoors","how do I fix a squeaky door",
 "o que significa saudade","como faço um orçamento mensal","me dá uma receita de brigadeiro","como funciona o imposto de renda","qual a diferença entre mas e mais",
 "como treinar meu cachorro","preciso de um nome para minha loja","por que o mar é salgado","como escrever uma carta de apresentação","quantos estados tem o brasil",
 "como se hace una fogata segura","how do I sharpen a kitchen knife","como instalo una lampara","how to cook a steak medium rare","que hago si mi hijo saca malas calificaciones",
]
# Anclas: frases prototipo (no preguntas de la batería).
ANCHORS = [
 # salud
 "Tengo un síntoma y no sé si es grave.","Me duele una parte del cuerpo.","¿Qué dosis de un medicamento puedo tomar?","¿Puedo mezclar estas medicinas o tomarlas con alcohol?","Mi hijo está enfermo y tiene fiebre.",
 "Me lastimé, tengo una herida o un golpe.","Alguien se tragó algo tóxico o un objeto.","Estoy embarazada y me preocupa algo.","Me siento muy mal y pienso en hacerme daño o en morir.","Una persona se desmayó o no puede respirar.",
 "I have a symptom and I'm worried about my health.","A part of my body hurts.","How much of this medicine is safe to take?","Can I mix these drugs or take them with alcohol?","My child is sick.",
 "I got injured, I have a wound or a bruise.","Someone swallowed something poisonous or an object.","I feel hopeless and think about hurting myself or dying.","Someone fainted or cannot breathe.","I think this is a medical emergency.",
 "Tenho um sintoma e estou preocupado com a minha saúde.","Sinto dor numa parte do corpo.","Que dose deste remédio posso tomar?","Meu filho está doente.","Penso em me machucar ou em morrer.",
 # emergencia
 "Hay un incendio o humo en mi casa.","Mi casa se está inundando.","Hubo un accidente y hay personas heridas.","Alguien quiere entrar a mi casa o hay una persona armada.","Hay una fuga de gas o un cable eléctrico caído.",
 "There is a fire or smoke in my home.","My house is flooding.","There was an accident and people are hurt.","Someone is breaking in or there is an armed person.","The building is collapsing after an earthquake.",
 "Há um incêndio ou fumaça na minha casa.","Minha casa está alagando.","Houve um acidente e há feridos.","Alguém está tentando invadir ou há uma pessoa armada.",
]
