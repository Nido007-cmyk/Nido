> **Idioma:** [English](../NIDO_INFORMATION_ARCHITECTURE.md) · Español

# NIDO Information Architecture

**Estado:** propuesta de diseño, v0.1 — para revisión, no implementación.
**Principio:** NIDO es un agente con el que hablas. La navegación existe para *encontrar cosas que el agente hizo*, no para operar al agente.

---

## 1. Mapa de la app

```
Onboarding (first run only)
└── Home (default)
    ├── Conversation (thread; opened from Home input or task)
    ├── Tasks
    │   └── Task detail (NIDO ↔ NIDO view when the task is inter-agent)
    ├── Contacts (NIDOs)
    │   └── Contact permissions (per contact: ✓ / • / ✕ tiers)
    ├── Privacy Activity ("Privacy Center")
    └── Settings
        └── Connection mode (Offline / Local-first / Online enhanced)
Approval request → modal sheet, reachable from anywhere (system-level)
```

**Bottom tabs (4):** Home · Contacts · Tasks · Privacy. (Ajustes vía engranaje del header de Home. Conversation no es un tab — es donde ya estás cuando hablas.)

Fundamento: las cuatro cosas que un usuario revisa sin preguntar son *personas en las que confío*, *cosas en vuelo*, y *qué salió de mi dispositivo*. Todo lo demás vive a un toque de Home.

---

## 2. Definiciones de pantalla

### 2.1 Onboarding (3 pasos, saltable tras el paso 1)
1. **Meet Nidito** — mascota hero (≤160px, una vez), promesa en una línea: *"An assistant that lives in your pocket — not in the cloud."*
2. **Private by design** — tres afirmaciones llanas: *Processed on device · You approve what leaves · No account, no cloud.*
3. **Choose how connected** — selector de modo: **Local-first** (recomendado) / Offline / Online enhanced, en palabras llanas. La elección se puede cambiar en Ajustes; nunca insiste después.
Por qué: establecer calidez + el contrato de privacidad + el modelo mental del modo antes de que exista ningún dato.

### 2.2 Home
Comunica *"this is MY NIDO"* de un vistazo:
- Saludo (Display M, consciente de la hora) + fecha.
- Línea de estado del agente: Nidito 40px + texto de estado (*Ready*, *Working on 2 tasks*, *Offline — fully usable*) + pill de modo sutil.
- **Pill de input principal** (voz/texto iguales) — la acción primaria de la pantalla.
- *Relevant now* — máx 3 tarjetas de tareas que el agente destacó (no un dashboard de botones).
- *Recent* — máx 3 filas en lenguaje llano (qué pasó, qué se compartió).
- Chip de privacidad en footer: *Processed on device · Nothing left your phone today* (o el conteo de disclosures de hoy).
Por qué no una cuadrícula de botones: la tesis del producto es "dile lo que necesitas". Cuadrículas de botones Calendar/Messages/Files reenmarcarían NIDO como un lanzador de apps.

### 2.3 Conversation
Hilo estándar: burbujas de usuario (olive-ghost, derecha), burbujas de NIDO (paper, izquierda, mascota 28px). Las tarjetas de resultado (p. ej. intervalos de disponibilidad) se renderizan como tarjetas estructuradas, no prosa. Cada disclosure lleva una **tarjeta de nota de privacidad**: *"I didn't include event details to keep your information private."* El contenido originado por el peer se cita con atribución (*From María's NIDO — not verified*). Las tareas largas pasan a Tasks con una tarjeta persistente en lugar de scroll infinito de estado.

### 2.4 Tarea NIDO ↔ NIDO (variante de detalle de tarea)
Debe responder en 3 segundos: *quién está involucrado, qué está pasando, qué salió de mi dispositivo.*
- **Leyenda de identidad** (siempre visible arriba): You · Your NIDO · María · María's NIDO — cuatro tratamientos distintos (iniciales vs mascota sólida vs mascota outline).
- **Tarjeta puente**: glyph de puente de doble mascota, *"Your NIDO ↔ María's NIDO"*, una línea de estado (*Negotiating availability…* → *Found a time — 6:00 PM*). Los estados de espera nombran quién tiene el siguiente paso.
- Lista **Shared so far**: log de disclosures en lenguaje llano para esta tarea (*Shared: Availability 6–7 PM · No calendar details shared*).
- **Nunca se muestra:** mensajes inter-agente, estados de protocolo, chain-of-thought, envelopes en crudo.
- Acciones terminales: *Propose to calendar* (ASK → sheet de aprobación), *Done*.

### 2.5 Solicitud de aprobación (modal sheet, nivel sistema)
Se dispara para cada decisión `ASK_USER`, desde cualquier lugar. Contenido, en orden:
1. Quién: *María's NIDO asks* (+ *From María's NIDO — not verified*).
2. Qué: capability en palabras llanas (*Propose a calendar event* + micro `calendar.event.propose/v1`).
3. **Qué saldría de tu teléfono** (categorías, nunca volcado de contenido): *Proposed time 6:00 PM. No event titles. No calendar details.*
4. Tres botones: **Only this time** / **Always for María** / **Never**. (Mapea a `ALLOW_ONCE` / `ALLOW_FOR_CONTACT` / `DENY`.)
5. Opcional: *Why am I seeing this?* → explicación de la regla en una línea (*Your rule: event proposals always ask*).
Anti-fatiga: el sheet agrupa solicitudes pendientes idénticas; aprobar "Always" escribe una regla version-pinned que el usuario puede inspeccionar en Contact permissions.

### 2.6 Tasks
Cuatro secciones fijas, en este orden: **Working** · **Waiting for another NIDO** · **Needs your approval** · **Completed**. Cada fila: título, contraparte (si hay), chip de estado, progreso o línea de siguiente paso. Las tareas largas persisten aquí con estado reanudable; tocar abre Conversation anclada en la tarea o la vista NIDO↔NIDO. Las tareas revocadas/denegadas muestran una fila terminal honesta (*Stopped — you revoked access · 2 of 5 steps done*).

### 2.7 Contacts / NIDOs
Lista people-first: cada fila = persona (nombre, avatar de inicial), debajo el estado de conexión de su NIDO: *Direct connection* (glyph de puente, oliva), *Reachable via relay*, *Pending pairing*, *Revoked*. Tocar → Contact permissions. Una fila *Pair new NIDO* (entrada QR/pairing) arriba del todo. Sin inventarios de capabilities, sin info de modelo/proveedor — el discovery anuncia interfaces, no inventarios.

### 2.8 Contact permissions
El Policy Engine hecho tangible. Header: persona + NIDO + conexión. Luego los **tres tiers**:
- **Can automatically** ✓ — p. ej. *Ask if I'm available* (`availability.query/v1`)
- **Must ask me** • — p. ej. *Create calendar events*, *Request files*
- **Never** ✕ — p. ej. *Access location*, *Read calendar details*
Cada fila: palabras llanas + micro `capability/version`. Tocar cicla tiers; ampliar requiere confirmación explícita (*"This lets María's NIDO do X without asking. Allow?"*). Nota de footer: *"Rules pin the exact capability and version. Updates never widen them silently."* + *Add rule* (guiado, con defaults seguros por sensibilidad).

### 2.9 Privacy Activity ("Privacy Center")
Una pregunta respondida: **qué salió de mi dispositivo, en segundos, en lenguaje llano.**
- Tira de hoy: *Nothing left your phone today* O un conteo + lista.
- Filas de timeline, cada una: glyph de nido, frase llana (*Shared availability 6–7 PM with María's NIDO*), sub-línea (*No calendar details shared · 2 of 20 hourly checks used*), hora.
- Secciones: **Local processing** (*312 requests processed on device this week*), **Internet usage** (*No Internet used* / por modo), **Connected NIDOs** (atajos), **Permissions** (atajo), **What was shared** (el timeline), **Recent agent actions** (decisiones: allowed/asked/denied con refs de regla).
- Cada fila expandible a la cadena de auditoría (*Why?* → eventos de decisión, sin chain-of-thought).

### 2.10 Settings / controles Offline–Online
- **Connection mode** (el único control "técnico", mantenido calmado): tres tarjetas radio —
  - *Offline* — "No network at all. NIDO↔NIDO over Bluetooth only."
  - *Local-first* (recomendado) — "Everything local; network only when you ask."
  - *Online enhanced* — "May use online services you approve, per task."
- Dispositivo y seguridad: bloqueo biométrico, cambiar/rotar identidad (con confirmación humana), dispositivos emparejados.
- Datos: exportar vault, borrar vault (ambos con confirmación explícita).
- Acerca de: versión, *How NIDO protects you* (enlace a docs), licencias.
El modo actual también aparece como la pill sutil en Home/headers — Ajustes es donde cambia, no donde grita.

---

## 3. Principios de navegación

1. **Hablar primero.** El camino más rápido a cualquier acción es el input de Home, no un menú.
2. **Las aprobaciones interrumpen; todo lo demás espera.** El sheet de aprobación es la única superficie system-modal.
3. **Sin callejones sin salida.** Cada resultado del agente enlaza a su tarea; cada tarea enlaza a sus disclosures; cada disclosure enlaza a su regla.
4. **La identidad siempre etiquetada.** Dondequiera que aparezcan dos NIDOs, la leyenda de cuatro vías (You / Your NIDO / persona / su NIDO) está presente o a un toque.
5. **Los modos son estados, no pantallas.** Offline/Local-first/Online-enhanced es una pill + sección de Ajustes, nunca un banner a pantalla completa.
