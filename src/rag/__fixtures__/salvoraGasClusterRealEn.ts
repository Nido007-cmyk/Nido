/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * 0.1.89: el clúster REAL inglés del mismo turno, extraído del
 * sqlite del pack firmado del dueño con la consulta FTS que la
 * app construye para «What do I do if I smell gas in my
 * house?» (`"smell" OR "smel"* OR "gas" OR "house"`) y la
 * puerta de cobertura de la casa. Son los 11 fragmentos
 * fundados en su orden BM25 real: aquí la fuga (45) ya va
 * primera y el monóxido (41) segundo, ambos a 2/3 (las guías
 * inglesas dicen «home», no «house»): el inglés no sufre la
 * inversión medida en español, y esta fixture lo deja probado.
 */
export interface RealClusterChunkEn {
  id: number;
  title: string;
  body: string;
  keys: string;
  bm25Rank: number;
  coverage: number;
}

export const SALVORA_GAS_CLUSTER_REAL_EN: RealClusterChunkEn[] = [
  {
    "id": 45,
    "title": "Gas Leak: How to Recognize It and Get Out in Time — Recognizing the leak",
    "body": "This guide is about natural gas delivered by pipeline. A leak can be recognized by smell, by sound and by sight. The safe response is not to look for where it comes from, but to leave the area by foot and call from outside.\n\nRecognizing the leak\nBy smell: an unusual smell, a petroleum odor or a gaseous odor. Distribution systems add mercaptan, a harmless chemical with a skunk like odor, to make a leak easier to detect.\n\nBy sound: the volume can range from a quiet hissing to a loud roar, depending on the size of the leak.\n\nBy sight: blowing dirt around a pipeline area, continuous bubbling in wet or flooded areas, and dead or discolored plants in an otherwise healthy area of vegetation.",
    "keys": "How can a natural gas leak be recognized by smell, sound and sight?\nWhat must I never do when I suspect a leak?\nWhere do I call from and who do I notify?\nWhen should I call 811?",
    "bm25Rank": -14.5373,
    "coverage": 2
  },
  {
    "id": 41,
    "title": "Carbon Monoxide: Detectors, Prevention and What to Do When the Alarm Sounds",
    "body": "Carbon monoxide, or CO, is an odorless, colorless gas that kills without warning. It is produced when fuel burns in equipment as common as gas and oil furnaces, portable generators and charcoal grills. Because you cannot see it or smell it, protection at home depends on two things: working detectors and a yearly service of fuel burning equipment.",
    "keys": "Why is carbon monoxide so dangerous if you cannot see or smell it?\nWhere do CO detectors belong and how are they maintained?\nWhich home appliances should be serviced every year?\nWhat do I do if the CO alarm sounds?",
    "bm25Rank": -13.3302,
    "coverage": 2
  },
  {
    "id": 49,
    "title": "Portable Generators: Using Them Without Letting Carbon Monoxide In",
    "body": "A portable generator exhaust contains carbon monoxide, a poison you cannot see or smell. Used in a confined space, a generator can produce high levels of CO within minutes.",
    "keys": "Where can a portable generator run and how far from the house?\nWhy is the garage not an option even with the door open?\nHow do I refuel it and where is gasoline stored?\nWhy must I never plug a generator into a wall outlet in the house?",
    "bm25Rank": -12.6756,
    "coverage": 2
  },
  {
    "id": 56,
    "title": "Shutting Off Power, Water and Gas: Where the Valves Are and How to Close Them — Gas: with a wrench and a quarter turn",
    "body": "Gas: with a wrench and a quarter turn\nThe valve is next to the meter. If the valve handle is parallel to the pipe, the gas is on. With pliers or a wrench, turn it 90 degrees, a quarter turn, so the handle is perpendicular to the pipe: that shuts the gas off.\n\nIf you smell gas or hear a blowing or hissing noise, open a window and get everyone out quickly. Turn off the gas using the outside main valve if you can and call the gas company from a neighbor's home.\n\nWarning: if you turn off the gas for any reason, only a qualified professional can turn it back on. Never attempt to turn the gas back on yourself.",
    "keys": "",
    "bm25Rank": -10.5482,
    "coverage": 2
  },
  {
    "id": 43,
    "title": "Carbon Monoxide: Detectors, Prevention and What to Do When the Alarm Sounds — Yearly service and things never to do",
    "body": "Yearly service and things never to do\nHave a qualified technician service your heating system, water heater and any other gas, oil or coal burning appliances every year.\n\nHave your chimney checked or cleaned every year: debris can block it and cause CO to build up inside your home.\n\nNever heat your house with a gas oven. Never burn charcoal indoors. Never use a portable gas camp stove indoors.\n\nNever run a car or truck inside a garage attached to a house, even with the garage door open.\n\nIf the alarm sounds\nIf the detector sounds, leave your home immediately and call 911.\n\nIf you suspect CO poisoning and you feel dizzy, light headed or nauseous, seek medical attention promptly.",
    "keys": "",
    "bm25Rank": -6.2878,
    "coverage": 2
  },
  {
    "id": 61,
    "title": "Water Inside the House: What to Do in the First Minutes (Burst Pipe, Washer, Water Heater) — First: shut off the main valve",
    "body": "When a pipe bursts or an appliance fails, water spreads quickly across floors and walls. The first minutes matter on two fronts: stop the water at its source and start drying as soon as possible, because mold is held back by drying in time.\n\nFirst: shut off the main valve\nFEMA stresses that it is vital that all household members learn how to shut off the water at the main house valve. It is the valve on the line that enters your house: find it today, tag it and make sure it can be shut off completely, so you are not searching for it with water already running.\n\nSafety before you touch anything\nBefore you start cleanup activities, check for loose power lines or gas leaks and make sure the electricity and gas are turned off. Watch out for wet, muddy or slippery floors.",
    "keys": "What is the first step if water gets inside the house?\nWhat do I do before I start cleaning up?\nHow fast does everything need to dry?\nWhat wet materials must be thrown away?",
    "bm25Rank": -6.1719,
    "coverage": 2
  },
  {
    "id": 55,
    "title": "Shutting Off Power, Water and Gas: Where the Valves Are and How to Close Them — Before the emergency: find the three shutoffs",
    "body": "Before the emergency: find the three shutoffs\nWater: find the shutoff valve for the main line that enters your house and tag it for easy identification. Make sure it can be shut off completely: if it is rusted open or does not close all the way, replace it. Make sure everyone in the household knows where it is.\n\nGas: there are different shutoff procedures for different gas meter configurations, so call your gas company and learn the procedure for your meter. Practice the route without actually turning the gas off.\n\nPower: locate your electrical circuit box and teach all responsible household members how to shut off the electricity.\n\nTool: the Ready.gov emergency supply list includes a wrench or pliers to turn off utilities. Keep that tool handy, next to the shutoffs.",
    "keys": "",
    "bm25Rank": -5.4909,
    "coverage": 2
  },
  {
    "id": 57,
    "title": "Shutting Off Power, Water and Gas: Where the Valves Are and How to Close Them — Water and power",
    "body": "Water and power\nThe valve you need to know is the main house valve, not the street valve in the cement box at the curb: the street valve is extremely difficult to turn and requires a special tool.\n\nWith electricity there is an order: for your safety, always shut off all the individual circuits before shutting off the main circuit. Electrical sparks can ignite natural gas if it is leaking, which is also why knowing how to cut the power matters.\n\nSource\nFEMA, Utility Shutoff and Safety; FEMA and American Red Cross, Repairing Your Flooded Home; Ready.gov (FEMA), Safety Skills and Build a Kit. Checked on November 7, 2026.",
    "keys": "",
    "bm25Rank": -5.056,
    "coverage": 2
  },
  {
    "id": 54,
    "title": "Shutting Off Power, Water and Gas: Where the Valves Are and How to Close Them",
    "body": "In a disaster you may be told to shut off the utility service at your home. FEMA asks that all household members know how to shut off the gas, the water and the electricity before that moment comes, and that the route be learned calmly, not during the emergency.",
    "keys": "Where is the main water valve and how do I check it?\nHow do I shut off the gas at the meter?\nWho can turn the gas back on?\nHow do I cut the power at the panel?",
    "bm25Rank": -3.1458,
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
    "id": 39,
    "title": "After a Home Fire: The First 24 Hours and Getting Back on Your Feet — Secure the home",
    "body": "Secure the home\nContact your local police department to let them know the site will be unoccupied. In some cases, you may need to board up openings, and to ask your insurance company what to do to keep your home safe until it is repaired, including covering doors, windows and other openings. The fire department will make sure the utility services (water, electricity and gas) are safe to use or are disconnected before they leave: do not try to turn them back on by yourself.",
    "keys": "",
    "bm25Rank": -1.9266,
    "coverage": 2
  }
];
