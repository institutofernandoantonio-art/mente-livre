import 'server-only';

import { isValidStructuredIntent } from './runtime-state-validation';
import type { StructuredIntent } from './types';

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
// ============================================================================

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

  return { status: 'extracted', intent: parsed };
}
