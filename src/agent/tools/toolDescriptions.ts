/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * toolDescriptions.ts — las descripciones del catálogo de herramientas en
 * inglés y portugués (auditoría de la 0.1.112, bloque 4).
 *
 * El catálogo entraba en español en el prompt de sistema de un turno en
 * inglés o portugués. La descripción española sigue viviendo en el
 * manifiesto (manifest.ts), que es la fuente de verdad del contrato; aquí
 * van sus gemelas, escritas para leerse naturales en cada lengua, no
 * traducidas palabra por palabra. Los nombres de herramienta y de
 * parámetro no se traducen: son el contrato con el despachador.
 *
 * La batería del bloque 4 (systemPromptLang0112.test.ts) exige una
 * entrada por herramienta del manifiesto: una herramienta nueva sin
 * sus gemelas rompe la batería.
 */

export const TOOL_DESCRIPTIONS_I18N: Readonly<Record<string, { en: string; pt: string }>> = {
  save_note: {
    en: "Saves a text note in the encrypted local store.",
    pt: "Guarda uma nota de texto no armazenamento local cifrado.",
  },
  list_notes: {
    en: "Lists the saved notes (titles and dates, without their content).",
    pt: "Lista as notas guardadas (títulos e datas, sem o conteúdo).",
  },
  read_note: {
    en: "Reads a note's content by its id.",
    pt: "Lê o conteúdo de uma nota pelo id.",
  },
  delete_note: {
    en: "Deletes a note by its id. It can't be undone and asks the user to confirm; the title goes in the confirmation so they know what is being deleted.",
    pt: "Apaga uma nota pelo id. Não tem volta e pede confirmação ao usuário; o título vai na confirmação para que saiba o que está sendo apagado.",
  },
  delete_memory: {
    en: "Forgets a saved memory (a fact or a person) by its id. It can't be undone and asks the user to confirm; the memory goes in the confirmation so they know what is being deleted.",
    pt: "Esquece uma memória guardada (um dado ou uma pessoa) pelo id. Não tem volta e pede confirmação ao usuário; a memória vai na confirmação para que saiba o que está sendo apagado.",
  },
  create_reminder: {
    en: "Creates a local reminder (a system alarm, no cloud).",
    pt: "Cria um lembrete local (alarme do sistema, sem nuvem).",
  },
  delete_reminder: {
    en: "Deletes a reminder by its id and cancels its notification. It can't be undone and asks the user to confirm; the text goes in the confirmation so they know what is being deleted.",
    pt: "Apaga um lembrete pelo id e cancela o aviso. Não tem volta e pede confirmação ao usuário; o texto vai na confirmação para que saiba o que está sendo apagado.",
  },
  remember_fact: {
    en: "Saves a fact about the user in persistent memory.",
    pt: "Guarda um dado sobre o usuário na memória persistente.",
  },
  save_person: {
    en: "Saves a person in persistent memory (name, family tie or relationship, and notes).",
    pt: "Guarda uma pessoa na memória persistente (nome, parentesco ou relação e notas).",
  },
  device_time: {
    en: "Returns the device's current date and time.",
    pt: "Devolve a data e a hora atuais do aparelho.",
  },
  open_app: {
    en: "Opens an explicit link outside NIDO (browser, dialer, messages or email). REQUIRES the user's explicit confirmation. Only these schemes are allowed: https, tel, sms, mailto (http is refused: it isn't encrypted). Any other scheme, or a malformed or empty link, is refused without opening anything.",
    pt: "Abre um link explícito fora do NIDO (navegador, discador, mensagens ou e-mail). EXIGE confirmação explícita do usuário. Só estes esquemas são permitidos: https, tel, sms, mailto (http é recusado: não é cifrado). Qualquer outro esquema, ou um link malformado ou vazio, é recusado sem abrir nada.",
  },
  calculate: {
    en: "Deterministic calculator: evaluates an arithmetic expression with no internet. Operators: + - * / % ^ and parentheses. Functions: sqrt abs round floor ceil sin cos tan ln log exp. Constants: pi, e. For percentages use x/100*y (e.g. «15/100*200» for 15% of 200).",
    pt: "Calculadora determinística: avalia uma expressão aritmética sem internet. Operadores: + - * / % ^ e parênteses. Funções: sqrt abs round floor ceil sin cos tan ln log exp. Constantes: pi, e. Para porcentagens use x/100*y (ex.: «15/100*200» para 15% de 200).",
  },
  convert_units: {
    en: "Converts between units of length, weight, temperature, volume and time. Accepts names in Spanish and English («meters», «pounds», «inches»). Units: m km cm mm mi ft in | kg g lb oz | c f k | l ml gal cup | s min h day.",
    pt: "Converte entre unidades de comprimento, peso, temperatura, volume e tempo. Aceita nomes em espanhol e inglês («metros», «libras», «polegadas»). Unidades: m km cm mm mi ft in | kg g lb oz | c f k | l ml gal cup | s min h day.",
  },
  create_calendar_event: {
    en: "Creates an event in the phone's calendar (with the user's permission).",
    pt: "Cria um evento na agenda do telefone (com permissão do usuário).",
  },
  list_calendar_events: {
    en: "Lists events from the phone's calendar within a date range.",
    pt: "Lista eventos da agenda do telefone num intervalo de datas.",
  },
  find_contact: {
    en: "Searches the phone's contacts by name (with the user's permission). It never dumps the whole address book.",
    pt: "Procura contatos do telefone pelo nome (com permissão do usuário). Nunca despeja a agenda inteira.",
  },
  place_call: {
    en: "Opens the phone's dialer with the number ready (the user confirms the call).",
    pt: "Abre o discador do telefone com o número pronto (o usuário confirma a ligação).",
  },
  send_sms: {
    en: "Opens the messaging app with the recipient and text ready (the user sends it).",
    pt: "Abre o app de mensagens com o destinatário e o texto prontos (o usuário envia).",
  },
  read_picked_file: {
    en: "Asks the user to pick a file with the system picker and reads its content as text (up to 200 KB). Use it to analyze documents, CSVs or notes the user gives you.",
    pt: "Pede ao usuário que escolha um arquivo no seletor do sistema e lê o conteúdo como texto (até 200 KB). Serve para analisar documentos, CSV ou notas que o usuário te passar.",
  },
  use_skill: {
    en: "Loads a skill's detailed step-by-step instructions. Use it when the task fits one of the skills listed in your prompt.",
    pt: "Carrega as instruções detalhadas, passo a passo, de uma skill. Use quando a tarefa se encaixar numa das skills listadas no seu prompt.",
  },
  analyze_table: {
    en: "Analyzes tabular data (CSV/TSV) you already have as text: columns, numeric statistics (sum, average, min, max), text values and the first rows. Supports filter («product=bread», «amount>100», combine with «;»), sort_by («-column» = descending) and top_n.",
    pt: "Analisa dados em tabela (CSV/TSV) que você já tenha como texto: colunas, estatísticas numéricas (soma, média, mín., máx.), valores de texto e as primeiras linhas. Aceita filter («produto=pão», «valor>100», combine com «;»), sort_by («-coluna» = decrescente) e top_n.",
  },
  nido_send_message: {
    en: "Sends an encrypted NIDO-to-NIDO message to a paired contact (no internet, over Bluetooth). If the contact is out of range, the message waits encrypted in the outbox.",
    pt: "Envia uma mensagem cifrada de NIDO para NIDO a um contato pareado (sem internet, por Bluetooth). Se o contato não estiver ao alcance, a mensagem fica cifrada na fila de saída.",
  },
  nido_read_inbox: {
    en: "Reads the received NIDO messages that haven't been read yet (phone to phone, encrypted).",
    pt: "Lê as mensagens NIDO recebidas que ainda não foram lidas (de telefone para telefone, cifradas).",
  },
  nido_my_code: {
    en: "Shows your NIDO pairing code (for the other phone to scan as a QR) and your fingerprint to check in person.",
    pt: "Mostra o seu código de pareamento NIDO (para o outro telefone escanear como QR) e a sua impressão digital para conferir pessoalmente.",
  },
  nido_pair: {
    en: "Pairs a NIDO contact by scanning their code (the QR text their NIDO shows you). This is the only way contacts are accepted: mutual opt-in. If the code clashes by name with another live contact of a DIFFERENT identity, you must ask the user for an explicit choice (see disambiguation): without a choice, pairing is cancelled; never assume «replace».",
    pt: "Pareia um contato NIDO escaneando o código dele (o texto do QR que o NIDO dele te mostra). Só assim se aceitam contatos: opt-in mútuo. Se o código colidir pelo nome com outro contato ativo de OUTRA identidade, peça ao usuário uma escolha explícita (ver disambiguation): sem escolha, o pareamento é cancelado; nunca presuma «replace».",
  },
  nido_review_tasks: {
    en: "Shows the remote NIDO tasks waiting for your approval: who asks, what they ask and when they arrived. Read only.",
    pt: "Mostra as tarefas NIDO remotas que aguardam a sua aprovação: quem pede, o que pede e quando chegaram. Só leitura.",
  },
  nido_approve_task: {
    en: "Approves a queued remote NIDO task (the user's explicit decision). It doesn't run it: it only records the approval.",
    pt: "Aprova uma tarefa NIDO remota na fila (decisão explícita do usuário). Não a executa: só registra a aprovação.",
  },
  nido_reject_task: {
    en: "Rejects a queued remote NIDO task (the user's explicit decision).",
    pt: "Recusa uma tarefa NIDO remota na fila (decisão explícita do usuário).",
  },
};
