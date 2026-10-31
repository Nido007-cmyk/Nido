# NIDO Local / NIDO Local / NIDO Local

Guías de NIDO por país: los números de emergencia comprobados, quién avisa y
qué significa cada alerta oficial (ciclones, sismos). Complementa a NIDO
Esencial, que tiene lo que vale en cualquier país (primeros auxilios,
huracanes, terremotos…). 23 países y territorios, en español, en inglés y en
portugués: Cuba, República Dominicana, Puerto Rico, México, Guatemala,
Honduras, El Salvador, Nicaragua, Costa Rica, Panamá, Colombia, Venezuela,
Ecuador, Perú, Bolivia, Chile, Argentina, Uruguay, Paraguay, España,
Portugal, Brasil y Estados Unidos.

NIDO guides by country: checked emergency numbers, who issues warnings and
what each official alert means (cyclones, earthquakes). It complements NIDO
Essentials, which covers what applies anywhere. 23 countries and territories,
in Spanish, English and Portuguese (same list as above).

Guias da NIDO por país: os números de emergência verificados, quem avisa e o
que significa cada alerta oficial (ciclones, terremotos). Complementa a NIDO
Essencial, que tem o que vale em qualquer país (primeiros socorros, furacões,
terremotos…). 23 países e territórios, em espanhol, em inglês e em português
(a mesma lista acima).

## Datos verificados / Verified facts / Fatos verificados (`facts.json`)

Cada número de emergencia está también en `facts.json` con su fuente, la cita
textual de la página oficial y la fecha en que se comprobó. La app responde
«¿a qué número llamo en X?» desde esa tabla, sin pasar por el modelo, y cita
la fuente. Un control semanal (`scripts/check-pack-claims.mjs`) vuelve a abrir
cada fuente y avisa si una cita ya no está.

Every emergency number is also in `facts.json` with its source, the exact quote
from the official page and the date it was checked. The app answers "what
number do I call in X?" from that table, without the model, and cites the
source. A weekly check (`scripts/check-pack-claims.mjs`) reopens every source
and warns when a quote is gone.

## Fuentes / Sources / Fontes

Cada guía cita las suyas en su cabecera (`sources:`), comprobadas el
2026-10-27/28. Cuando no pudimos abrir la web oficial (Defensa Civil de Cuba),
la guía lo dice y nombra la fuente usada.

Each guide cites its own in its header (`sources:`), checked on 2026-10-27/28.
Where the official website could not be opened (Cuba's Civil Defense), the
guide says so and names the source used.

Las organizaciones citadas no han escrito, revisado ni respaldado estas guías.
The organizations cited did not write, review or endorse these guides.
As organizações citadas não escreveram, revisaram nem respaldaram estes guias.
Información general: en una emergencia, llama al número de emergencias.
General information: in an emergency, call your emergency number.
Informação geral: em uma emergência, ligue para o número de emergência.
