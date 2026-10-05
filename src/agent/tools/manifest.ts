/**
 * NIDO — manifiesto de herramientas LOCALES.
 * Regla de privacidad: ninguna herramienta de esta lista toca la red.
 * Si una herramienta futura necesitara red, no entra aquí: iría a un
 * manifiesto separado con consentimiento explícito por uso.
 */

export interface ToolParameter {
  type: "string" | "number" | "boolean";
  description: string;
  required?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, ToolParameter>;
}

export const LOCAL_TOOLS: ToolDefinition[] = [
  {
    name: "save_note",
    description: "Guarda una nota de texto en el almacén local cifrado.",
    parameters: {
      title: { type: "string", description: "Título de la nota", required: true },
      body: { type: "string", description: "Contenido", required: true },
    },
  },
  {
    name: "list_notes",
    description: "Lista las notas guardadas (títulos y fechas, sin contenido).",
    parameters: {},
  },
  {
    name: "read_note",
    description: "Lee el contenido de una nota por su id.",
    parameters: {
      id: { type: "string", description: "Id de la nota", required: true },
    },
  },
  {
    name: "create_reminder",
    description: "Crea un recordatorio local (alarma del sistema, sin nube).",
    parameters: {
      text: { type: "string", description: "Qué recordar", required: true },
      at: { type: "string", description: "Fecha/hora ISO local", required: true },
    },
  },
  {
    name: "remember_fact",
    description: "Guarda un dato sobre el usuario en la memoria persistente.",
    parameters: {
      content: { type: "string", description: "El dato, en palabras del usuario", required: true },
      category: { type: "string", description: "general | preference | goal | event" },
    },
  },
  {
    name: "device_time",
    description: "Devuelve la fecha y hora actual del dispositivo.",
    parameters: {},
  },
  {
    name: "open_app",
    description:
      "Abre un enlace explícito fuera de NIDO (navegador, marcador, mensajes o correo). " +
      "REQUIERE confirmación explícita del usuario. Solo esquemas permitidos: https, http, tel, sms, mailto. " +
      "Cualquier otro esquema, enlace malformado o vacío se rechaza sin abrir nada.",
    parameters: {
      link: {
        type: "string",
        description:
          "Enlace explícito a abrir (p.ej. https://ejemplo.com, tel:+15551234567). Solo https/http/tel/sms/mailto.",
        required: true,
      },
    },
  },
  {
    name: "calculate",
    description:
      "Calculadora determinista: evalúa una expresión aritmética sin internet. " +
      "Operadores: + - * / % ^ y paréntesis. Funciones: sqrt abs round floor ceil sin cos tan ln log exp. " +
      "Constantes: pi, e. Para porcentajes usa x/100*y (p.ej. «15/100*200» para el 15% de 200).",
    parameters: {
      expression: { type: "string", description: "Expresión a evaluar, p.ej. «(15/100*200)+30»", required: true },
    },
  },
  {
    name: "convert_units",
    description:
      "Convierte entre unidades de longitud, peso, temperatura, volumen y tiempo. " +
      "Acepta nombres en español e inglés («metros», «libras», «pulgadas»). " +
      "Unidades: m km cm mm mi ft in | kg g lb oz | c f k | l ml gal cup | s min h day.",
    parameters: {
      value: { type: "number", description: "Cantidad a convertir", required: true },
      from: { type: "string", description: "Unidad origen, p.ej. «km» o «millas»", required: true },
      to: { type: "string", description: "Unidad destino, p.ej. «m» o «metros»", required: true },
    },
  },
  {
    name: "create_calendar_event",
    description: "Crea un evento en el calendario del teléfono (permiso del usuario).",
    parameters: {
      title: { type: "string", description: "Título del evento", required: true },
      start: { type: "string", description: "Inicio en ISO-8601 local, p.ej. «2026-09-27T10:00:00»", required: true },
      end: { type: "string", description: "Fin en ISO-8601 local (opcional)" },
      notes: { type: "string", description: "Notas del evento (opcional)" },
      location: { type: "string", description: "Lugar (opcional)" },
    },
  },
  {
    name: "list_calendar_events",
    description: "Lista eventos del calendario del teléfono en un rango de fechas.",
    parameters: {
      from: { type: "string", description: "Desde, ISO-8601 (por defecto: ahora)" },
      to: { type: "string", description: "Hasta, ISO-8601 (por defecto: 7 días)" },
      limit: { type: "number", description: "Máximo de eventos (por defecto 20)" },
    },
  },
  {
    name: "find_contact",
    description: "Busca contactos del teléfono por nombre (permiso del usuario). No vuelca la agenda completa.",
    parameters: {
      query: { type: "string", description: "Nombre o parte del nombre a buscar", required: true },
    },
  },
  {
    name: "place_call",
    description: "Abre el marcador del teléfono con el número listo (el usuario confirma la llamada).",
    parameters: {
      phone: { type: "string", description: "Número de teléfono", required: true },
    },
  },
  {
    name: "send_sms",
    description: "Abre la app de mensajes con destinatario y texto listos (el usuario envía).",
    parameters: {
      phone: { type: "string", description: "Número de teléfono", required: true },
      message: { type: "string", description: "Texto del mensaje", required: true },
    },
  },
  {
    name: "read_picked_file",
    description:
      "Pide al usuario elegir un archivo con el selector del sistema y lee su contenido como texto " +
      "(máx. 200 KB). Sirve para analizar documentos, CSV o notas que el usuario te pase.",
    parameters: {},
  },
  {
    name: "use_skill",
    description:
      "Carga las instrucciones detalladas de una skill (guía paso a paso en español). " +
      "Úsala cuando la tarea encaje con una skill listada en tu prompt.",
    parameters: {
      name: { type: "string", description: "Nombre de la skill, p.ej. «analiza-datos»", required: true },
    },
  },
  {
    name: "analyze_table",
    description:
      "Analiza datos tabulares (CSV/TSV) que ya tengas como texto: columnas, estadísticas " +
      "numéricas (suma, promedio, min, max), valores de texto y primeras filas. " +
      "Soporta filter («producto=pan», «importe>100», combina con «;»), sort_by («-columna» = descendente) y top_n.",
    parameters: {
      text: { type: "string", description: "Contenido de la tabla (p.ej. lo leído con read_picked_file)", required: true },
      filter: { type: "string", description: "Filtros «columna=valor», separados por «;» (opcional)" },
      sort_by: { type: "string", description: "Columna para ordenar; «-col» = descendente (opcional)" },
      top_n: { type: "number", description: "Filas a mostrar (por defecto 5, máx. 20)" },
    },
  },
  // Fase E: mensajería NIDO a NIDO, cifrada, sin internet.
  {
    name: "nido_send_message",
    description:
      "Envía un mensaje cifrado de NIDO a NIDO a un contacto emparejado (sin internet, por Bluetooth cuando el módulo nativo esté listo). " +
      "Si el contacto no está al alcance, el mensaje queda cifrado en la cola de salida.",
    parameters: {
      to: { type: "string", description: "Nombre del contacto NIDO emparejado", required: true },
      text: { type: "string", description: "Texto del mensaje (máx. 4000 caracteres)", required: true },
    },
  },
  {
    name: "nido_read_inbox",
    description:
      "Lee los mensajes NIDO recibidos que aún no se han leído (de teléfono a teléfono, cifrados).",
    parameters: {},
  },
  {
    name: "nido_my_code",
    description:
      "Muestra tu código de emparejamiento NIDO (para que el otro teléfono lo escanee como QR) y tu huella para verificarla en persona.",
    parameters: {},
  },
  {
    name: "nido_pair",
    description:
      "Empareja un contacto NIDO escaneando su código (el texto del QR que te muestra su NIDO). Solo así se aceptan contactos: opt-in mutuo. Si el código colisiona en nombre con otro contacto vivo de OTRA identidad, debes pedir al usuario una elección explícita (ver disambiguation): sin elección, el emparejamiento se cancela; jamás asumas «replace».",
    parameters: {
      code: { type: "string", description: "Texto del código QR del otro NIDO (empieza con «NIDO1:»)", required: true },
      disambiguation: {
        type: "string",
        description:
          "Requerido cuando el QR colisiona en nombre con un contacto vivo de otra identidad (la herramienta te lo indicará con las 3 opciones). «replace»: es la misma persona con un dispositivo nuevo — retira la identidad vieja en TODAS partes (destructivo, pide confirmación explícita al usuario). «different_person»: otra persona — requiere new_name único y ambas identidades conviven. «cancel»: no hacer nada. Sin elección explícita del usuario, usa «cancel».",
        required: false,
      },
      new_name: {
        type: "string",
        description: "Requerido con disambiguation=different_person: nombre único para el contacto nuevo (no puede repetirse entre contactos vivos).",
        required: false,
      },
    },
  },
  // M-6: bandeja de aprobación para tareas remotas encoladas. Las tareas
  // nunca se auto-ejecutan; aprobar/rechazar son acciones sensibles con
  // confirmación explícita.
  {
    name: "nido_review_tasks",
    description:
      "Muestra las tareas NIDO remotas pendientes de tu aprobación: quién las pide, qué piden y cuándo llegaron. Solo lectura.",
    parameters: {},
  },
  {
    name: "nido_approve_task",
    description:
      "Aprueba una tarea NIDO remota encolada (decisión explícita del usuario). No la ejecuta: solo registra la aprobación.",
    parameters: {
      id: { type: "string", description: "Id de la tarea pendiente (ver nido_review_tasks)", required: true },
    },
  },
  {
    name: "nido_reject_task",
    description: "Rechaza una tarea NIDO remota encolada (decisión explícita del usuario).",
    parameters: {
      id: { type: "string", description: "Id de la tarea pendiente (ver nido_review_tasks)", required: true },
    },
  },
];
