import 'server-only';

import { isValidStructuredIntent } from './runtime-state-validation';
import type { StructuredIntent, TemporalWindow } from './types';

// ============================================================================
// Intent extraction — a fronteira que transforma texto livre do usuário em
// um `StructuredIntent` validado, via IA.
//
// Mesmo racional de separação já estabelecido no relatório de mapeamento da
// subfase correspondente: "NLU entende, orquestração decide, storage
// persiste, execution executa". Este módulo é SÓ o "NLU entende".
//
// Este módulo NUNCA:
// - persiste nada (nenhum insert, nenhuma tabela, nenhum runtime state);
// - gera identificadores (`crypto.randomUUID()`) — não é dessa camada;
// - chama `createConversationState`/`resolveFirstConversationalTurn`/
//   `resolveClarificationConversationalTurn`/`resolveProposalConversationalTurn`/
//   `buildProposedAction`/`createProposalState` — nenhuma orquestração,
//   nenhuma Clarification/Confirmation Policy, nenhuma Execution;
// - importa `runtime-state-storage`/`../supabase/server`/`../supabase/admin`/
//   `conversation-turn`/`proposal-turn`/`local-task-execution` — zero
//   Supabase, zero storage, zero client de nenhum tipo;
// - decide confirmação, autorização, ou executa qualquer ação;
// - consulta Google Calendar;
// - aceita `userId`/`stateId`/`proposalId`/`expiresAt`/client Supabase/
//   `ProposedAction` como argumento — recebe SÓ o texto do usuário e `now`.
//
// --- Padrão Anthropic: reaproveitado, não reinventado -----------------
//
// Mesmo padrão real e único já usado no projeto
// (`callAnthropicToOrganize`, src/lib/supabase/actions.ts): `fetch()` cru
// para a API de Messages da Anthropic (sem SDK — nenhuma dependência nova),
// mesma env var (`ANTHROPIC_API_KEY`), mesmos headers, mesma versão de API,
// mesmo modelo (`claude-opus-5`), mesmo formato de request/response, mesma
// disciplina de nunca confiar na resposta bruta do provider (toda saída
// passa por parsing + validação explícita antes de qualquer uso).
//
// --- `now`: determinístico, nunca `Date.now()` interno -------------------
//
// `now` (epoch ms) é sempre um argumento explícito de quem chama — mesmo
// princípio já usado em toda a `src/lib/conversation/`. Convertido para
// ISO 8601 UTC e injetado no PROMPT DO SISTEMA (nunca misturado ao texto
// do usuário) como única referência de "agora" que o modelo pode usar
// para resolver expressões relativas ("amanhã", "daqui a 2 horas") — o
// modelo nunca deve inventar seu próprio relógio.
//
// --- Validação: o type guard em TS é a fonte final de verdade -----------
//
// O prompt pede JSON estrito seguindo o contrato real, mas o prompt NUNCA
// é tratado como garantia — a saída do modelo é sempre `unknown` até
// passar por `isValidStructuredIntent` (reaproveitado de
// runtime-state-validation.ts, exportado exatamente para este fim — ver
// relatório de mapeamento e subfase de export). Nenhum segundo validator
// manual é escrito aqui: `JSON.parse` + `isValidStructuredIntent`, nunca
// `as StructuredIntent`.
//
// --- `invalid` vs `error` ------------------------------------------------
//
// `invalid` = o pedido local já não fazia sentido (texto vazio, `now`
// inválido) OU o modelo respondeu algo que, mesmo sendo JSON parseável ou
// texto, não é um `StructuredIntent` válido segundo o contrato real —
// nesses casos o TEXTO em si é o problema, não a infraestrutura.
// `error` = falha técnica/de provider: API key ausente, `fetch` rejeitou,
// HTTP não-ok, ou o ENVELOPE HTTP do provider não tem o shape esperado
// (não é sobre o que o modelo disse, é sobre a chamada em si ter
// funcionado). Nenhum dos dois vaza corpo bruto do provider.
//
// --- Guard determinístico: coerência "hoje"/"amanhã" explícitos ----------
// (Subfase 13 da criação de compromissos no Google Calendar — causa raiz
// comprovada por reprodução real: a mesma frase "Agende amanhã às 17h30
// uma reunião de teste por 30 minutos." produziu, em 3 chamadas reais
// idênticas à Anthropic, 2 respostas corretas (`relative_day`/`tomorrow`/
// 17:30) e 1 resposta errada (`fixed`, dia 03/09 em vez de 02/09, hora
// civil local tratada como se já fosse UTC) — ver relatório da Subfase 13
// para o histórico completo.)
//
// EXTENSÃO (Subfase 18): mesma causa raiz, reproduzida de novo em
// produção para um texto SEM "hoje"/"amanhã" explícitos ("Marca uma
// ligação às 21:00 por 30 minutos.") — a LLM devolveu `fixed` com a hora
// civil (21:00) embutida como se já fosse UTC, e a prévia (corretamente
// convertida para America/Sao_Paulo, UTC-3) mostrou 18:00. O guard original
// só comparava texto vs. intent quando havia "hoje"/"amanhã" explícito;
// esta subfase estende o reconhecimento de "dia" para também cobrir um
// horário mencionado SOZINHO, sem nenhuma palavra de dia (equivale a
// "hoje" em português) — nunca um parser novo, mesma função, mesma
// regex de hora, só mais um jeito de reconhecer "dia".
//
// Princípio: LLM interpreta -> CÓDIGO DETERMINÍSTICO valida -> só depois o
// intent é aceito. Este guard NUNCA corrige/reescreve o intent (isso
// criaria um segundo parser temporal paralelo à NLU) — ele só COMPARA o
// texto original com o `TemporalWindow` já produzido e, em caso de
// divergência explícita, derruba a extração inteira para `invalid` (o
// mesmo status já usado para "o modelo respondeu algo que não é um
// StructuredIntent válido segundo o contrato real" — ver seção acima).
// `invalid` já é, em todo o pipeline (`conversation-entry.ts`), um
// caminho seguro e terminal: nunca chega a `resolveCalendarQuery`,
// `attemptCreateEvent`, freeBusy, `ProposedAction`/`ProposalState`, claim
// ou Google write.
//
// Escopo MÍNIMO e deliberado (ver relatório para o porquê de cada
// exclusão): reconhece "hoje"/"amanhã"/"amanha" (case-insensitive, sem
// acento) — ou a AUSÊNCIA de qualquer palavra de dia (ver
// OTHER_DAY_REFERENCE_RE/achado da Subfase 18: um horário sozinho, sem
// nenhuma referência de dia, significa "hoje" em português) — SEGUIDO ou
// PRECEDIDO por um horário explícito no texto original nos formatos já
// usados no produto ("17h", "17h30", "17:30", com ou sem "às"/"as"
// antes). Qualquer outra expressão temporal ("fim da tarde", "depois de
// amanhã", "próxima semana", dias da semana, datas por extenso) continua
// 100% responsabilidade da NLU/Clarification Policy existente — este
// guard nunca tenta entendê-las, sempre `not_applicable` para elas. Dia
// relativo SEM horário explícito ("amanhã", sozinho) também é
// `not_applicable` — nunca inventa nem exige um horário.
//
// Aplica-se a QUALQUER `intentType` que carregue um campo `temporalWindow`
// (`create_task`, `create_event`, `plan_task`, `query_calendar`,
// `suggest_time`, `reschedule_event`) — nunca dois guards diferentes para
// `query_calendar` e `create_event`. `set_reminder` usa um campo
// diferente (`reminderWindow`) e fica fora desta primeira versão (ver
// limitações no relatório da subfase); `capture_thought`/`cancel_event`/
// `request_followup`/`conversational_question` não têm nenhum campo de
// janela temporal e são sempre `not_applicable` aqui.
//
// Zero I/O, zero `Date.now()`, zero Google, zero Supabase, zero Anthropic,
// zero mutação do intent recebido — só compara texto vs. intent já
// produzido, os dois já em mãos de quem chama.
export type ExplicitRelativeDateTimeConsistency = 'valid' | 'mismatch' | 'not_applicable';

type ExplicitDayTime = { day: 'today' | 'tomorrow'; hour: number; minute: number };

// Remove acentos (NFD + descarte dos diacríticos combinantes) só para
// comparação — nunca usado para nada além de reconhecer "amanhã"/"amanha"
// e "às"/"as" de forma equivalente. O texto original de quem chama nunca
// é alterado por este módulo.
function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

// "depois de amanhã" (dia SEGUINTE a amanhã) nunca deve ser confundido com
// o "amanhã" simples que este guard entende — mascarado ANTES da busca do
// dia, com o mesmo número de caracteres (nunca desloca posições), para que
// o "amanha" embutido nele jamais conte como um match de `tomorrow`.
const DAY_AFTER_TOMORROW_RE = /\bdepois de amanha\b/g;

// Qualquer menção a um dia DIFERENTE de "hoje" que este guard não sabe
// interpretar — dia da semana, "semana que vem", "depois"/"ontem", ou uma
// data explícita (DD/MM ou "dia N"). Escopo mínimo e deliberado, mesmo
// espírito da lista de exclusões já documentada no cabeçalho desta seção
// (nunca tenta entender "fim da tarde"/"próxima semana"/datas por
// extenso) — presença de qualquer um destes sempre desliga a inferência
// de "hoje implícito" abaixo, nunca um palpite sobre um dia que este
// código não entende.
const OTHER_DAY_REFERENCE_RE =
  /\b(segunda|terca|quarta|quinta|sexta|sabado|domingo|semana|proxim[oa]|depois|ontem)\b|\d{1,2}\/\d{1,2}|\bdia\s+\d{1,2}\b/;

// Extrai, SOMENTE do texto original, um par (dia relativo, hora civil)
// quando ambos aparecem de forma explícita e inequívoca — nunca um
// palpite. `null` significa "este guard não tem opinião sobre este
// texto" (ambíguo, ausente, ou fora do escopo mínimo documentado acima).
function extractExplicitDayTime(text: string): ExplicitDayTime | null {
  const preMaskNormalized = stripDiacritics(text.toLowerCase());
  const normalized = preMaskNormalized.replace(DAY_AFTER_TOMORROW_RE, (match) =>
    ' '.repeat(match.length),
  );

  const hasToday = /\bhoje\b/.test(normalized);
  const hasTomorrow = /\bamanha\b/.test(normalized);
  // Checado no texto ANTES do mascaramento de "depois de amanhã" — do
  // contrário "depois" (que faz parte do próprio trecho mascarado)
  // desapareceria junto, e "depois de amanhã às 17h30" cairia,
  // incorretamente, na inferência de "hoje" abaixo.
  const hasOtherDayReference = OTHER_DAY_REFERENCE_RE.test(preMaskNormalized);

  let day: 'today' | 'tomorrow';
  if (hasToday && !hasTomorrow) {
    day = 'today';
  } else if (hasTomorrow && !hasToday) {
    day = 'tomorrow';
  } else if (!hasToday && !hasTomorrow && !hasOtherDayReference) {
    // Nem "hoje" nem "amanhã" nem qualquer outra referência de dia que
    // este guard reconheça (ver OTHER_DAY_REFERENCE_RE) — em português,
    // um horário de relógio mencionado sozinho ("às 21h") significa HOJE
    // por padrão, nunca uma data que ninguém disse. Mesma causa raiz do
    // achado real desta subfase: sem isso, um `fixed`/`anchored_start`
    // com a hora civil embutida como se já fosse UTC passava batido
    // (nunca comparado a nada, por falta de "hoje"/"amanhã" explícitos no
    // texto) e a prévia mostrava um horário 3h adiantado/atrasado.
    day = 'today';
  } else {
    // "hoje" e "amanhã" juntos (frase ambígua), OU alguma outra
    // referência de dia que este guard não entende (dia da semana, data,
    // "depois de amanhã", etc.) -> sem opinião, nunca um palpite.
    return null;
  }

  // Formatos cobertos, do mais específico ao mais genérico: "17h30",
  // "17:30", "17h" sozinho (minuto implícito 0). "às"/"as" nunca é exigido
  // pela regex — é só um prefixo opcional do português. Faixa 0-23/0-59 já
  // embutida na própria regex (nunca aceita, por ex., "25h" como hora).
  const hourMinuteMatch = normalized.match(/\b([01]?\d|2[0-3])h([0-5]\d)\b/);
  const colonMatch = normalized.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  const bareHourMatch = normalized.match(/\b([01]?\d|2[0-3])h(?!\d)/);
  const match = hourMinuteMatch ?? colonMatch ?? bareHourMatch;
  if (!match) {
    return null;
  }

  const hour = Number(match[1]);
  const minute = match[2] === undefined ? 0 : Number(match[2]);

  return { day, hour, minute };
}

// Único ponto que sabe QUAIS `intentType` carregam um `TemporalWindow` a
// validar aqui — switch explícito, nunca `as`/acesso solto a uma
// propriedade que nem todo membro da união tem (mesmo padrão já usado em
// clarification.ts). `null` = "este intentType está fora do escopo deste
// guard" (nunca um erro).
function extractTemporalWindowForGuard(intent: StructuredIntent): TemporalWindow | null {
  switch (intent.intentType) {
    case 'create_task':
    case 'create_event':
    case 'plan_task':
    case 'query_calendar':
    case 'suggest_time':
    case 'reschedule_event':
      return intent.temporalWindow;
    case 'capture_thought':
    case 'cancel_event':
    case 'set_reminder':
    case 'request_followup':
    case 'conversational_question':
      return null;
  }
}

// API pública do guard — pura, sem I/O, comparando só texto vs. intent já
// produzidos por quem chama (ver cabeçalho desta seção para o contrato
// completo). `mismatch` é a única saída que deve derrubar a extração.
export function validateExplicitRelativeDateTimeConsistency(
  text: string,
  intent: StructuredIntent,
): ExplicitRelativeDateTimeConsistency {
  const explicit = extractExplicitDayTime(text);
  if (explicit === null) {
    return 'not_applicable';
  }

  const window = extractTemporalWindowForGuard(intent);
  if (window === null) {
    return 'not_applicable';
  }

  const resolved = window.resolved;
  if (resolved.kind !== 'relative_day') {
    // `fixed`/`anchored_start`/`next_free_slot`/`relative_to_event`/
    // `unresolved` nunca podem substituir silenciosamente um "hoje"/
    // "amanhã às X" explícito no texto original — ver causa raiz da
    // Subfase 13.
    return 'mismatch';
  }
  if (resolved.day !== explicit.day || resolved.time === null) {
    return 'mismatch';
  }
  if (resolved.time.hour !== explicit.hour || resolved.time.minute !== explicit.minute) {
    return 'mismatch';
  }
  return 'valid';
}

export type ExtractIntentResult =
  | { status: 'extracted'; intent: StructuredIntent }
  | { status: 'invalid' }
  | { status: 'error' };

// --- Validação mínima de boundary (mesmo padrão de local-task-execution.ts) -

function isValidNow(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);
}

// Texto vazio ou só espaço não chega a ser um pedido — `trim()` só para a
// checagem, nunca para o texto de fato enviado ao provider (preservado
// verbatim, ver chamada abaixo).
function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

// Mesma implementação/racional já usado em local-task-execution.ts —
// duplicação pequena e aceitável de um utilitário genérico, não de regra
// de domínio (ver decisão equivalente já tomada naquele módulo).
function toIsoTimestamp(ms: number): string | null {
  if (!isValidNow(ms)) {
    return null;
  }
  try {
    return new Date(ms).toISOString();
  } catch {
    return null;
  }
}

// --- Prompt do sistema ---------------------------------------------------
//
// Descreve o contrato REAL das 11 variantes de StructuredIntent
// (types.ts) — deliberadamente não restrito só a `create_task`: este
// módulo só entende, nunca decide o que é materializável (isso é
// responsabilidade de buildProposedAction, numa camada totalmente
// diferente). Regras de negócio (ex.: "não invente prazo") seguem o mesmo
// espírito já usado em ORGANIZE_SYSTEM_PROMPT (actions.ts).
function buildSystemPrompt(nowIso: string): string {
  return `Você transforma uma mensagem curta de um usuário de um app de produtividade em EXATAMENTE um objeto JSON StructuredIntent. Responda SOMENTE com esse objeto JSON — sem nenhum texto antes ou depois, sem bloco de código markdown (sem \`\`\`), sem explicação, sem pergunta ao usuário.

Data/hora de referência (UTC, ISO 8601): ${nowIso}
Use esse valor, e SÓ esse valor, para resolver expressões relativas de tempo ("amanhã", "sexta", "daqui a 2 horas") — nunca invente ou assuma outro instante "atual".

Todo objeto tem sempre estes dois campos, além dos específicos de cada intentType abaixo:
- "missingFields": array de zero ou mais valores, cada um exatamente um destes literais: "task_title","time","duration","participant","event_reference","temporal_window","reminder_time". Inclua um campo aqui só se ele for relevante para a intenção mas não puder ser determinado a partir do texto.
- "confidence": número entre 0 e 1 (inclusive) — sua confiança geral nesta interpretação.

Nenhuma chave além das listadas para cada formato abaixo pode aparecer no objeto final.

Escolha exatamente UM destes formatos, pelo campo "intentType":

1. capture_thought — pensamento solto, sem ação clara de tarefa/evento:
   {"intentType":"capture_thought","task": null | {"kind":"new_task","title":"...","description":"..."|null}}

2. create_task — criar uma tarefa/lembrete local, sem reservar hora fixa de agenda:
   {"intentType":"create_task","task":{"kind":"new_task","title":"...","description":"..."|null},"temporalWindow":null,"duration":<ResolvedValue<{"minutes":number}>>|null,"deadline":<ResolvedValue<{"at":"ISO8601"}>>|null}
   "temporalWindow" é SEMPRE null nesta intenção.

3. create_event — criar um evento novo na agenda:
   {"intentType":"create_event","task":{"kind":"new_task","title":"...","description":"..."|null},"temporalWindow":<TemporalWindow>,"duration":<ResolvedValue<{"minutes":number}>>|null,"participants":[<ParticipantRef>, ...],"calendarAction":"create"}

4. plan_task — pedir para planejar/encaixar algo (novo ou já existente) numa janela:
   {"intentType":"plan_task","subject":<IntentSubject>,"temporalWindow":<TemporalWindow>}

5. query_calendar — perguntar sobre disponibilidade/agenda, sem criar nada:
   {"intentType":"query_calendar","temporalWindow":<TemporalWindow>}

6. suggest_time — pedir sugestão de horário para algo (novo ou já existente):
   {"intentType":"suggest_time","subject":<IntentSubject>,"temporalWindow":<TemporalWindow>,"duration":<ResolvedValue<{"minutes":number}>>|null}

7. reschedule_event — remarcar um evento já existente:
   {"intentType":"reschedule_event","eventReference":<EventReference>,"temporalWindow":<TemporalWindow>,"calendarAction":"reschedule"}

8. cancel_event — cancelar um evento já existente:
   {"intentType":"cancel_event","eventReference":<EventReference>,"calendarAction":"cancel"}

9. set_reminder — pedir um lembrete futuro sobre algo (novo ou já existente):
   {"intentType":"set_reminder","subject":<IntentSubject>,"reminderWindow":<TemporalWindow>}

10. request_followup — pedir para retomar/dar seguimento a algo já existente:
    {"intentType":"request_followup","subject":<EventReference>}

11. conversational_question — uma pergunta em linguagem natural, sem ação:
    {"intentType":"conversational_question","question":"..."}

Onde:

<ResolvedValue<T>> é exatamente um destes três formatos:
- {"source":"stated","value":T,"confidence":number} — o usuário disse isso explicitamente.
- {"source":"inferred","value":T,"confidence":number} — você deduziu isso com base razoável no texto, mas o usuário não disse literalmente.
- {"source":"unresolved","confidence":number} — o dado é relevante para a intenção, mas não pôde ser determinado; NUNCA inclua "value" neste caso.
Nunca marque como "stated" algo que você inferiu, nem invente um "value" para algo que o usuário não disse nem permite deduzir com segurança.

<EventReference> é sempre {"kind":"existing_reference","raw":"texto exato usado pelo usuário para se referir a isso","resolvedId":null} — "resolvedId" é SEMPRE null (você nunca sabe a que id real isso corresponde).

<ParticipantRef> é sempre {"raw":"como o usuário se referiu à pessoa","resolvedId":null} — "resolvedId" é SEMPRE null.

<IntentSubject> é OU um TaskRef novo ({"kind":"new_task","title":"...","description":"..."|null}) OU uma <EventReference>, nunca os dois.

<TemporalWindow> é sempre {"expression":"frase original do usuário sobre tempo","resolved": um destes seis formatos}:
- {"kind":"fixed","start":"ISO8601","end":"ISO8601"} — início e fim já conhecidos.
- {"kind":"anchored_start","start":"ISO8601"} — início conhecido, fim/duração ainda não.
- {"kind":"relative_day","day":"today"|"tomorrow","time":{"hour":number,"minute":number}|null} — dia relativo conhecido; "time" só se a hora também foi dita/deduzida.
- {"kind":"next_free_slot","minDurationMinutes":number|null} — "quando eu tiver um horário livre".
- {"kind":"relative_to_event","anchor":"before"|"after","eventReference":<EventReference>} — relativo a outro evento/tarefa.
- {"kind":"unresolved"} — nenhuma informação temporal suficiente para os outros formatos.

Regra obrigatória sobre "hoje"/"amanhã": quando o texto do usuário disser explicitamente "hoje às X" ou "amanhã às X" (com horário explícito), o resultado DEVE usar {"kind":"relative_day","day":"today"|"tomorrow","time":{"hour":X,...}} — NUNCA converta essas expressões para "fixed" nem para "anchored_start". "fixed" só deve ser usado para uma referência temporal já absoluta e apropriada ao contrato (ex.: uma data completa dita pelo usuário, "10 de outubro às 14h"), nunca como substituto de "hoje"/"amanhã".

Regra obrigatória sobre horário sem dia explícito: quando o texto mencionar só um horário de relógio ("às 21h", "21:00", "9h") SEM dizer "amanhã" nem nenhum outro dia (nem dia da semana, nem data, nem "depois de amanhã"), isso significa HOJE nesse horário — o resultado DEVE usar {"kind":"relative_day","day":"today","time":{"hour":X,...}}, NUNCA "fixed"/"anchored_start". Você NUNCA tem o fuso horário real do usuário — um "fixed"/"anchored_start" com hora de relógio embutida (ex.: "21:00:00Z") seria interpretado como UTC e produziria um horário diferente do que a pessoa disse; "relative_day" é resolvido corretamente em outra camada, com o fuso horário real.

Regras gerais, sempre válidas:
- Nunca invente informação que não está no texto nem é dedução razoável e explícita a partir dele.
- Nunca decida se uma ação está confirmada, autorizada, ou deve ser executada — isso não é sua função.
- Nunca consulte, assuma ou invente disponibilidade real de calendário.
- Nunca inclua texto de conversa, pergunta ao usuário, ou qualquer coisa fora do objeto JSON.
- Se o texto for ambíguo demais para qualquer formato acima, prefira "conversational_question" com "confidence" baixo a inventar uma interpretação sem base.`;
}

// --- API pública -----------------------------------------------------------

export async function extractStructuredIntent(text: string, now: number): Promise<ExtractIntentResult> {
  if (!isNonBlankString(text)) {
    return { status: 'invalid' };
  }

  const nowIso = toIsoTimestamp(now);
  if (nowIso === null) {
    return { status: 'invalid' };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  // `isNonBlankString` (não só `!apiKey`): uma env var presente mas só com
  // espaço (`'   '`) é truthy em JS — passaria pela checagem `!apiKey` e
  // chegaria ao fetch como uma API key inválida.
  if (!isNonBlankString(apiKey)) {
    return { status: 'error' };
  }

  let response: Response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-5',
        max_tokens: 500,
        output_config: { effort: 'low' },
        system: buildSystemPrompt(nowIso),
        messages: [{ role: 'user', content: text }],
      }),
    });
  } catch {
    // Falha de rede/timeout — mesma disciplina de callAnthropicToOrganize:
    // tratada como falha técnica, nunca propagada crua.
    return { status: 'error' };
  }

  if (!response.ok) {
    return { status: 'error' };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { status: 'error' };
  }

  if (typeof payload !== 'object' || payload === null || !('content' in payload)) {
    return { status: 'error' };
  }

  const content = (payload as { content: unknown }).content;
  if (!Array.isArray(content)) {
    return { status: 'error' };
  }

  // Exige EXATAMENTE um bloco de texto — nunca escolhe arbitrariamente o
  // primeiro entre vários, nunca concatena. Zero blocos ou dois-ou-mais
  // blocos de texto são igualmente um shape de provider inesperado
  // (`error`), não uma questão de "qual escolher".
  const textBlocks = content.filter(
    (block): block is { type: 'text'; text: string } =>
      typeof block === 'object' &&
      block !== null &&
      (block as { type?: unknown }).type === 'text' &&
      typeof (block as { text?: unknown }).text === 'string',
  );

  if (textBlocks.length !== 1) {
    // Envelope do provider sem exatamente um bloco de texto utilizável —
    // falha do provider/infra, não do conteúdo entendido, por isso
    // `error` (mesma fronteira já usada em callAnthropicToOrganize).
    return { status: 'error' };
  }

  const textBlock = textBlocks[0];

  // A partir daqui, qualquer problema é sobre O QUE o modelo disse, nunca
  // sobre a chamada em si ter funcionado — por isso `invalid`, não `error`.
  let parsed: unknown;
  try {
    parsed = JSON.parse(textBlock.text.trim());
  } catch {
    return { status: 'invalid' };
  }

  // Única fonte de verdade sobre o shape — nunca `as StructuredIntent`,
  // nunca um segundo validator manual escrito aqui.
  if (!isValidStructuredIntent(parsed)) {
    return { status: 'invalid' };
  }

  // Guard determinístico (Subfase 13) — depois do shape validado, antes de
  // entregar ao dispatcher. `mismatch` reaproveita o mesmo `invalid` já
  // usado para "o modelo respondeu algo que não é um StructuredIntent
  // válido" (ver seção "Guard determinístico" acima) — nunca um status
  // novo, nunca uma segunda chamada, nunca uma correção automática do
  // intent.
  if (validateExplicitRelativeDateTimeConsistency(text, parsed) === 'mismatch') {
    return { status: 'invalid' };
  }

  return { status: 'extracted', intent: parsed };
}
