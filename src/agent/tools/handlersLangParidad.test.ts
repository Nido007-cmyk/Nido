/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * F-PC50 (paquete de arreglos del móvil, §7): paridad de idioma de los
 * handlers de las fases B, D y E. Antes de esta tanda, calculate,
 * convert_units, los eventos, los contactos, llamada/SMS, el lector de
 * archivos, use_skill, analyze_table y toda la mensajería NIDO devolvían
 * sus textos SOLO en español, hablara la app el idioma que hablara. La
 * batería cobra cada salida en es/en/pt contra la salida real del
 * handler, con los módulos nativos simulados como en
 * handlers.permissions.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
});

const state = vi.hoisted(() => ({
  contactsGranted: true,
  contactsCanAskAgain: true,
  requestGrants: true,
  book: [] as Array<{ fullName: string; phones: Array<{ number: string }> }>,
  calendarEvents: [] as Array<Record<string, unknown>>,
  picker: { canceled: true, assets: [] as Array<Record<string, unknown>> } as Record<string, unknown>,
  fileText: "",
  sendQueued: true,
  pairError: null as Error | null,
  inbox: { messages: [] as Array<Record<string, unknown>>, hiddenTemporal: 0 },
}));

vi.mock("expo-calendar", () => ({
  getCalendarPermissions: async () => ({ granted: true, canAskAgain: true }),
  requestCalendarPermissions: async () => ({ granted: true, canAskAgain: true }),
  getCalendars: async () => [
    { id: "1", allowsModifications: true, isPrimary: true, createEvent: async () => "evt-1" },
  ],
  listEvents: async () => state.calendarEvents,
}));

vi.mock("expo-contacts", () => ({
  getPermissionsAsync: async () => ({
    granted: state.contactsGranted,
    canAskAgain: state.contactsCanAskAgain,
  }),
  requestPermissionsAsync: async () => ({
    granted: state.requestGrants,
    canAskAgain: state.contactsCanAskAgain,
  }),
  Contact: {
    getAllDetails: async (_fields: string[], options?: { name?: string }) => {
      const name = options?.name;
      if (!name) return state.book;
      return state.book.filter((c) => c.fullName.toLowerCase().includes(name.toLowerCase()));
    },
  },
}));

vi.mock("expo-document-picker", () => ({
  getDocumentAsync: async () => state.picker,
}));

vi.mock("expo-file-system", () => ({
  File: class {
    async arrayBuffer(): Promise<ArrayBuffer> {
      return new TextEncoder().encode(state.fileText).buffer as ArrayBuffer;
    }
  },
}));
vi.mock("expo-sqlite", () => ({}));
vi.mock("react-native", () => ({ Linking: { openURL: vi.fn(async () => undefined) }, Platform: { OS: "android" } }));

vi.mock("../../services/nidoMessenger", () => ({
  getSharedNidoMessenger: () => ({
    ensureIdentity: async () => ({ fingerprint: "FP:01" }),
    myPairingCode: async () => "CODIGO-TEST",
    sendChat: async () => ({ queued: state.sendQueued }),
    contacts: async () => [],
    readInboxWithHidden: async () => state.inbox,
    pairWith: async () => {
      if (state.pairError) throw state.pairError;
      return { name: "Luz", pkHex: "ab" };
    },
  }),
}));

import { buildToolHandlers, searchPhoneContacts, setHandlerLangForTest } from "./handlers";
import { StaleReplaceConflictError } from "../../p2p/store";
import { __resetPermissionGuardForTests } from "../../p2p/permissionGuard";

type Lang = "es" | "en" | "pt";
const LANGS: Lang[] = ["es", "en", "pt"];
type ToolMap = ReturnType<typeof buildToolHandlers>;
const handlers = (): ToolMap => buildToolHandlers({ requestConfirm: async () => true });

beforeEach(() => {
  __resetPermissionGuardForTests();
  state.contactsGranted = true;
  state.contactsCanAskAgain = true;
  state.requestGrants = true;
  state.book = [{ fullName: "Ana López", phones: [{ number: "555-111-2222" }] }];
  state.calendarEvents = [];
  state.picker = { canceled: true, assets: [] };
  state.fileText = "";
  state.sendQueued = true;
  state.pairError = null;
  state.inbox = { messages: [], hiddenTemporal: 0 };
});

afterEach(() => {
  setHandlerLangForTest(null);
});

/** Corre el mismo escenario en los tres idiomas y cobra su salida. */
function caso(
  nombre: string,
  run: (h: ToolMap) => Promise<string>,
  esperado: Record<Lang, string>,
  modo: "eq" | "starts" | "contains" = "eq",
  setup?: () => void,
): void {
  for (const lang of LANGS) {
    it(`${nombre} [${lang}]`, async () => {
      setup?.();
      setHandlerLangForTest(lang);
      const out = await run(handlers());
      if (modo === "eq") expect(out).toBe(esperado[lang]);
      else if (modo === "starts") expect(out.startsWith(esperado[lang])).toBe(true);
      else expect(out).toContain(esperado[lang]);
    });
  }
}

describe("calculate y convert_units", () => {
  caso("calculate sin expresión", (h) => h.calculate({}), {
    es: "Error: falta la expresión a calcular.",
    en: "Error: the expression to calculate is missing.",
    pt: "Erro: falta a expressão a calcular.",
  });
  caso(
    "calculate con expresión rota sirve su prefijo",
    (h) => h.calculate({ expression: "((2" }),
    {
      es: "No pude calcular eso: ",
      en: "I couldn't calculate that: ",
      pt: "Não consegui calcular isso: ",
    },
    "starts",
  );
  caso("convert_units sin número", (h) => h.convert_units({ value: "x" }), {
    es: "Error: el valor a convertir debe ser un número.",
    en: "Error: the value to convert must be a number.",
    pt: "Erro: o valor a converter deve ser um número.",
  });
  caso("convert_units sin unidades", (h) => h.convert_units({ value: 5 }), {
    es: "Error: indica la unidad de origen y la de destino.",
    en: "Error: give the source unit and the target unit.",
    pt: "Erro: indica a unidade de origem e a de destino.",
  });
});

describe("calendario", () => {
  caso("create_calendar_event sin título", (h) => h.create_calendar_event({}), {
    es: "Error: falta el título del evento.",
    en: "Error: the event title is missing.",
    pt: "Erro: falta o título do evento.",
  });
  caso(
    "create_calendar_event sirve su marco de éxito",
    (h) => h.create_calendar_event({ title: "Dentista", start: "2027-01-15T10:00:00" }),
    {
      es: "Evento creado: «Dentista», ",
      en: "Event created: “Dentista”, ",
      pt: "Evento criado: «Dentista», ",
    },
    "starts",
  );
  caso("list_calendar_events vacío", (h) => h.list_calendar_events({}), {
    es: "No hay eventos en ese rango.",
    en: "There are no events in that range.",
    pt: "Não há eventos nesse intervalo.",
  });
  caso(
    "list_calendar_events con un evento sin título",
    (h) => h.list_calendar_events({}),
    {
      es: "Próximos eventos:\n- «(sin título)»",
      en: "Upcoming events:\n- «(untitled)»",
      pt: "Próximos eventos:\n- «(sem título)»",
    },
    "starts",
    () => {
      state.calendarEvents = [{ startDate: new Date(2027, 0, 16, 9, 0).toISOString() }];
    },
  );
});

describe("contactos", () => {
  caso(
    "searchPhoneContacts sin nombre",
    async () => {
      const res = await searchPhoneContacts("");
      return res.ok ? "OK" : res.message;
    },
    {
      es: "Error: falta el nombre a buscar.",
      en: "Error: the name to search for is missing.",
      pt: "Erro: falta o nome a buscar.",
    },
  );
  caso("find_contact sin coincidencias", (h) => h.find_contact({ query: "Zzz" }), {
    es: "No encontré ningún contacto que coincida con «Zzz».",
    en: "I couldn't find any contact matching “Zzz”.",
    pt: "Não encontrei nenhum contato que corresponda a «Zzz».",
  });
  caso(
    "find_contact sirve su cabecera",
    (h) => h.find_contact({ query: "Ana" }),
    {
      es: "Contactos encontrados:\n- Ana López — 555-111-2222",
      en: "Contacts found:\n- Ana López — 555-111-2222",
      pt: "Contatos encontrados:\n- Ana López — 555-111-2222",
    },
  );
  caso(
    "find_contact sin teléfono",
    (h) => h.find_contact({ query: "Ana" }),
    {
      es: "- Ana López — sin teléfono",
      en: "- Ana López — no phone",
      pt: "- Ana López — sem telefone",
    },
    "contains",
    () => {
      state.book = [{ fullName: "Ana López", phones: [] }];
    },
  );
  caso(
    "permiso de contactos bloqueado",
    async () => {
      const res = await searchPhoneContacts("Ana");
      return res.ok ? "OK" : res.message;
    },
    {
      es: "El permiso de contactos está bloqueado para NIDO.",
      en: "Contacts permission is blocked for NIDO.",
      pt: "A permissão de contatos está bloqueada para o NIDO.",
    },
    "starts",
    () => {
      state.contactsGranted = false;
      state.contactsCanAskAgain = false;
    },
  );
  caso(
    "permiso de contactos denegado al pedirlo",
    async () => {
      const res = await searchPhoneContacts("Ana");
      return res.ok ? "OK" : res.message;
    },
    {
      es: "No diste permiso de contactos, así que no puedo buscar.",
      en: "You didn't give contacts permission, so I can't search.",
      pt: "Você não deu permissão de contatos, então não posso buscar.",
    },
    "starts",
    () => {
      state.contactsGranted = false;
      state.requestGrants = false;
    },
  );
});

describe("llamada y SMS", () => {
  caso("place_call sin número", (h) => h.place_call({}), {
    es: "Error: falta un número de teléfono válido.",
    en: "Error: a valid phone number is missing.",
    pt: "Erro: falta um número de telefone válido.",
  });
  caso("place_call abre el marcador", (h) => h.place_call({ phone: "+1 555 123 4567" }), {
    es: "Abriendo el marcador con +15551234567… confírmame tú la llamada.",
    en: "Opening the dialer with +15551234567… you confirm the call.",
    pt: "Abrindo o discador com +15551234567… confirme você a chamada.",
  });
  caso("send_sms sin texto", (h) => h.send_sms({ phone: "5551234" }), {
    es: "Error: falta el texto del mensaje.",
    en: "Error: the message text is missing.",
    pt: "Erro: falta o texto da mensagem.",
  });
  caso(
    "send_sms abre mensajes",
    (h) => h.send_sms({ phone: "5551234", message: "Hola" }),
    {
      es: "Abriendo mensajes para 5551234 con el texto listo… envíalo tú cuando quieras.",
      en: "Opening messages for 5551234 with the text ready… send it yourself whenever you want.",
      pt: "Abrindo mensagens para 5551234 com o texto pronto… envie você quando quiser.",
    },
  );
});

describe("read_picked_file", () => {
  caso("sin elegir archivo", (h) => h.read_picked_file({}), {
    es: "No elegiste ningún archivo.",
    en: "You didn't choose any file.",
    pt: "Você não escolheu nenhum arquivo.",
  });
  caso(
    "archivo de texto",
    (h) => h.read_picked_file({}),
    {
      es: "Archivo «notas.txt» (0 KB):\nhola",
      en: "File “notas.txt” (0 KB):\nhola",
      pt: "Arquivo «notas.txt» (0 KB):\nhola",
    },
    "eq",
    () => {
      state.picker = { canceled: false, assets: [{ name: "notas.txt", size: 4, uri: "file://x" }] };
      state.fileText = "hola";
    },
  );
  caso(
    "archivo grande por su tamaño declarado",
    (h) => h.read_picked_file({}),
    {
      es: "«grande.bin» pesa más de 200 KB; elige un archivo de texto más pequeño.",
      en: "“grande.bin” is over 200 KB; choose a smaller text file.",
      pt: "«grande.bin» pesa mais de 200 KB; escolha um arquivo de texto menor.",
    },
    "eq",
    () => {
      state.picker = { canceled: false, assets: [{ name: "grande.bin", size: 300_000, uri: "file://x" }] };
    },
  );
  caso(
    "archivo vacío",
    (h) => h.read_picked_file({}),
    {
      es: "«vacio.txt» está vacío o no es texto legible.",
      en: "“vacio.txt” is empty or isn't readable text.",
      pt: "«vacio.txt» está vazio ou não é texto legível.",
    },
    "eq",
    () => {
      state.picker = { canceled: false, assets: [{ name: "vacio.txt", size: 0, uri: "file://x" }] };
      state.fileText = "   ";
    },
  );
  caso(
    "archivo largo se anuncia recortado",
    (h) => h.read_picked_file({}),
    {
      es: "\n…(recortado)",
      en: "\n…(trimmed)",
      pt: "\n…(cortado)",
    },
    "contains",
    () => {
      state.picker = { canceled: false, assets: [{ name: "largo.txt", size: 9000, uri: "file://x" }] };
      state.fileText = "a".repeat(9000);
    },
  );
});

describe("use_skill y analyze_table", () => {
  caso("use_skill sin nombre", (h) => h.use_skill({}), {
    es: "Indica el nombre de la skill. Disponibles:",
    en: "Give the skill name. Available:",
    pt: "Indica o nome da skill. Disponíveis:",
  }, "starts");
  caso("use_skill desconocida", (h) => h.use_skill({ name: "no-existe-xyz" }), {
    es: "No conozco la skill «no-existe-xyz». Disponibles:",
    en: "I don't know the skill “no-existe-xyz”. Available:",
    pt: "Não conheço a skill «no-existe-xyz». Disponíveis:",
  }, "starts");
  caso("analyze_table sin texto", (h) => h.analyze_table({}), {
    es: "Error: falta el texto de la tabla a analizar.",
    en: "Error: the table text to analyze is missing.",
    pt: "Erro: falta o texto da tabela a analisar.",
  });
  caso("analyze_table demasiado grande", (h) => h.analyze_table({ text: "x".repeat(200 * 1024 + 1) }), {
    es: "Error: la tabla supera los 200 KB. Pide al usuario un archivo más pequeño.",
    en: "Error: the table exceeds 200 KB. Ask the user for a smaller file.",
    pt: "Erro: a tabela ultrapassa os 200 KB. Peça ao usuário um arquivo menor.",
  });
});

describe("mensajería NIDO", () => {
  caso("nido_send_message sin contacto", (h) => h.nido_send_message({}), {
    es: "Error: indica el nombre del contacto NIDO.",
    en: "Error: give the NIDO contact name.",
    pt: "Erro: indica o nome do contato NIDO.",
  });
  caso("nido_send_message sin texto", (h) => h.nido_send_message({ to: "Luz" }), {
    es: "Error: el mensaje está vacío.",
    en: "Error: the message is empty.",
    pt: "Erro: a mensagem está vazia.",
  });
  caso(
    "nido_send_message encolado",
    (h) => h.nido_send_message({ to: "Luz", text: "Hola" }),
    {
      es: "Mensaje para «Luz» guardado cifrado en la cola de salida: se entregará cuando su NIDO esté al alcance.",
      en: "Message for “Luz” saved encrypted in the outbox: it will be delivered when their NIDO is in range.",
      pt: "Mensagem para “Luz” guardada criptografada na fila de saída: será entregue quando o NIDO dessa pessoa estiver ao alcance.",
    },
  );
  caso(
    "nido_send_message entregado",
    (h) => h.nido_send_message({ to: "Luz", text: "Hola" }),
    {
      es: "Mensaje enviado a «Luz» por NIDO (cifrado de extremo a extremo).",
      en: "Message sent to “Luz” over NIDO (end-to-end encrypted).",
      pt: "Mensagem enviada a “Luz” pelo NIDO (criptografia de ponta a ponta).",
    },
    "eq",
    () => {
      state.sendQueued = false;
    },
  );
  caso("nido_read_inbox vacío", (h) => h.nido_read_inbox({}), {
    es: "No tienes mensajes NIDO sin leer.",
    en: "You have no unread NIDO messages.",
    pt: "Você não tem mensagens NIDO não lidas.",
  });
  caso(
    "nido_read_inbox con una tarea pendiente",
    (h) => h.nido_read_inbox({}),
    {
      es: "Pendiente de tu aprobación — revísala con nido_review_tasks (id 7).",
      en: "Pending your approval — review it with nido_review_tasks (id 7).",
      pt: "Pendente da sua aprovação — revise com nido_review_tasks (id 7).",
    },
    "contains",
    () => {
      state.inbox = {
        messages: [
          { peerPk: "ab", ts: Date.now(), text: "haz esto", type: "agent_task", status: "queued", id: 7 },
        ],
        hiddenTemporal: 0,
      };
    },
  );
  caso("nido_my_code", (h) => h.nido_my_code({}), {
    es: "Tu código de emparejamiento NIDO (muéstralo como QR para que el otro teléfono lo escanee):\nCODIGO-TEST\nHuella para verificar en persona: FP:01",
    en: "Your NIDO pairing code (show it as a QR so the other phone can scan it):\nCODIGO-TEST\nFingerprint to verify in person: FP:01",
    pt: "Seu código de emparelhamento NIDO (mostre-o como QR para que o outro telefone o escaneie):\nCODIGO-TEST\nImpressão digital para verificar em pessoa: FP:01",
  });
  caso("nido_pair sin código", (h) => h.nido_pair({}), {
    es: "Error: falta el código del otro NIDO.",
    en: "Error: the other NIDO's code is missing.",
    pt: "Erro: falta o código do outro NIDO.",
  });
  caso("nido_pair sirve su marco de éxito", (h) => h.nido_pair({ code: "X" }), {
    es: "Contacto «Luz» emparejado, sin verificar todavía.",
    en: "Contact “Luz” paired, not verified yet.",
    pt: "Contato “Luz” emparelhado, ainda sem verificar.",
  }, "starts");
  caso(
    "nido_pair con reemplazo nombra la identidad retirada",
    (h) => h.nido_pair({ code: "X", disambiguation: "replace" }),
    {
      es: "La identidad anterior quedó retirada en todas partes: murieron sus rutas, sesiones y mensajes pendientes; los mensajes antiguos siguen legibles.",
      en: "The previous identity was retired everywhere: its routes, sessions and pending messages are gone; old messages stay readable.",
      pt: "A identidade anterior foi retirada de todos os lugares: suas rotas, sessões e mensagens pendentes deixaram de existir; as mensagens antigas continuam legíveis.",
    },
    "contains",
  );
  caso(
    "nido_pair con conflicto de reemplazo",
    (h) => h.nido_pair({ code: "X" }),
    {
      es: "No pude emparejar: la identidad que se pretendía reemplazar ya fue retirada por otro emparejamiento.",
      en: "I couldn't pair: the identity that was to be replaced was already retired by another pairing.",
      pt: "Não consegui emparelhar: a identidade que se pretendia substituir já foi retirada por outro emparelhamento.",
    },
    "starts",
    () => {
      state.pairError = new StaleReplaceConflictError(["ab"], null);
    },
  );
  caso(
    "nido_pair con error genérico sirve su prefijo",
    (h) => h.nido_pair({ code: "X" }),
    {
      es: "No pude emparejar: boom",
      en: "I couldn't pair: boom",
      pt: "Não consegui emparelhar: boom",
    },
    "eq",
    () => {
      state.pairError = new Error("boom");
    },
  );
});
