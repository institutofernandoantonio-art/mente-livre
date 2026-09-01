import 'server-only';

import { getGoogleCalendarAccessToken } from '../google/calendar';
import { isValidProposedCalendarEventEvent } from './runtime-state-validation';
import type { ProposedAction } from './proposed-action';

// ============================================================================
// Calendar event execution — a primitiva server-side isolada que sabe
// fazer UM `events.insert` idempotente no Google Calendar, a partir de um
// `googleEventId` determinístico já obtido pelo CLAIM
// (`calendar-event-claim.ts`) e do payload já validado de
// `ProposedAction.create_calendar_event.event`.
//
// Subfase 6 da criação de compromissos no Google Calendar: cria SOMENTE
// esta primitiva, isolada e testável. Esta subfase deliberadamente NÃO:
// - conecta esta função a `proposal-turn.ts`/à confirmação do usuário —
//   "sim" em create_calendar_event continua retornando `error` sem chamar
//   nada disto (ver proposal-turn.ts, ramo `confirmed`, inalterado);
// - chama claim/finalize/cancel — esta função não sabe que essas três
//   existem, não lê/escreve `conversation_runtime_states`/
//   `calendar_event_executions`, não decide lifecycle;
// - muda o escopo OAuth — a conexão Google em produção continua só com
//   `calendar.events.freebusy` (ver `../google/calendar`). Chamar esta
//   função contra uma conexão real hoje receberia 403 do próprio Google
//   (escopo insuficiente), mapeado para `error` abaixo (nunca
//   `unauthorized` — ver "unauthorized: só 401 e falha em obter access
//   token" mais abaixo) — nunca um crash, mas também NUNCA um evento
//   criado de verdade enquanto o escopo de escrita
//   (`https://www.googleapis.com/auth/calendar.events`) não for
//   solicitado numa subfase própria e futura, o que também exigirá que
//   usuários já conectados reconectem (a conexão hoje só tem consent
//   para freebusy).
//
// --- Endpoint — sempre o calendário primário, sempre create -------------
//
// `POST https://www.googleapis.com/calendar/v3/calendars/primary/events`
// — nunca um `calendarId` arbitrário (sempre o literal `primary`), nunca
// update/patch/delete/move. Nenhum outro verbo/endpoint da Calendar API é
// implementado aqui.
//
// --- Input — deliberadamente mínimo --------------------------------------
//
// `googleEventId`: string opaca já derivada pelo CLAIM
// (`lower(replace(proposalId, '-', ''))`, ver
// supabase/migrations/20260901100000_create_calendar_event_executions.sql)
// — esta função NUNCA gera nem deriva um id, só valida o FORMATO recebido
// (32 hex minúsculos) antes de usá-lo.
//
// `event`: exatamente o shape de `ProposedAction.create_calendar_event.event`
// (title/description/start/end/timezone/reminderMinutesBeforeStart) — a
// MESMA `ProposedAction` que sobrevive intacta na `ProposalState` durante
// todo o lifecycle CLAIMED -> GOOGLE -> FINALIZE.
//
// Este módulo NUNCA aceita/deriva: userId, proposalId, `ProposalState`/
// runtime state, access token, refresh token, calendarId, escopo OAuth,
// `now`. A identidade do usuário é derivada exclusivamente por
// `getGoogleCalendarAccessToken()` (`../google/calendar`) a partir da
// SESSÃO atual — nunca de um parâmetro externo. `reminderMinutesBeforeStart`
// continua um literal fixo (30) nesta V1: validado aqui, mas nunca aceito
// como campo configurável no payload enviado ao Google (hardcoded abaixo).
//
// --- Autenticação/token — reutilizada, nunca duplicada -------------------
//
// `getGoogleCalendarAccessToken()` é o MESMO helper (extraído nesta
// subfase, sem mudança de comportamento) já usado por
// `getGoogleCalendarBusyTimes` — único ponto do projeto que lê
// `google_calendar_connections`/faz refresh do access token. Este módulo
// nunca abre uma segunda conexão Supabase, nunca usa
// `createAdminClient()` diretamente, nunca reimplementa o refresh OAuth.
//
// --- Resultado — pequeno, sem nenhum dado do Google ----------------------
//
// `created | already_exists | unauthorized | error` — nunca event id,
// link, payload do Google, título, tokens, ou corpo bruto de erro. O
// corpo da resposta do Google NUNCA é lido (nem em sucesso, nem em erro)
// — a decisão inteira é feita só pelo `status` HTTP, que já é suficiente
// para os 4 resultados possíveis; isso também elimina por construção
// qualquer risco de vazar um `id`/link/summary de volta por engano.
//
// --- 409 é sucesso idempotente, não erro ---------------------------------
//
// Como `googleEventId` é SEMPRE derivado deterministicamente do mesmo
// `proposalId` (nunca muda em retries da mesma proposta — ver o CLAIM), um
// 409 do Google para o MESMO id que acabamos de enviar significa apenas
// "um evento com este id já existe" — quase sempre porque uma tentativa
// anterior já criou o evento e a resposta HTTP se perdeu antes de a futura
// camada chamadora poder chamar FINALIZE. Tratado como `already_exists`,
// um resultado de SUCESSO para efeitos de idempotência — nunca como
// `error`, nunca como motivo para gerar um novo id, nunca como motivo
// para uma segunda chamada (GET para "confirmar", retry, etc.). A futura
// camada que conectar isto ao lifecycle real poderá chamar FINALIZE tanto
// para `created` quanto para `already_exists`.
//
// --- unauthorized: só 401 e falha em obter access token -------------------
//
// Existe como um resultado distinto de `error` especificamente para que
// uma futura camada possa diferenciar "faltou credencial" (que pede
// reconexão do usuário) de uma falha técnica genérica (que não pede).
// Deliberadamente CONSERVADOR nesta V1: só duas situações caem em
// `unauthorized`: (a) a própria chamada ao Google respondeu 401
// (credencial inválida/expirada); (b) não foi possível sequer obter um
// access token (`getGoogleCalendarAccessToken()` retornou null — sem
// conexão, refresh falhou) — mesma família de causa raiz ("não temos
// credencial válida para agir em nome deste usuário").
//
// HTTP 403 é tratado como `error`, NUNCA `unauthorized` — correção
// deliberada desta subfase: um 403 da Calendar API pode significar
// escopo insuficiente, mas também limite/quota excedida ou uma restrição
// operacional não relacionada a credencial. Classificar todo 403 como
// "faltou permissão, peça para reconectar" seria impreciso e poderia um
// dia mandar o usuário reconectar o Google por um motivo errado. Nesta
// V1, sem fazer parsing do body/`reason` do Google (explicitamente fora
// de escopo — não introduzir essa complexidade agora), 403 colapsa em
// `error`, o status genérico já usado para qualquer falha que não seja
// claramente "faltou credencial". Uma subfase futura de OAuth de escrita
// poderá refinar essa distinção lendo `reason`, se necessário.
//
// --- Zero retry, zero segunda chamada, zero GET de confirmação -----------
//
// No máximo 1 fetch por chamada desta função. Nenhuma tentativa de
// "confirmar" um 409 com uma leitura adicional, nenhum retry automático
// em falha técnica — mesma disciplina anti-TOCTOU/anti-efeito-duplo já
// aplicada em toda a pilha de Calendar (claim/finalize/cancel).
// ============================================================================

const GOOGLE_EVENT_ID_PATTERN = /^[0-9a-f]{32}$/;

function isValidGoogleEventId(value: unknown): value is string {
  return typeof value === 'string' && GOOGLE_EVENT_ID_PATTERN.test(value);
}

// Mesmo shape de `ProposedAction.create_calendar_event.event` — nunca
// redeclarado à mão, sempre derivado do tipo real via `Extract`, para que
// uma futura mudança em `proposed-action.ts` force este arquivo a
// recompilar em vez de divergir silenciosamente.
type CalendarEventInput = Extract<ProposedAction, { actionType: 'create_calendar_event' }>['event'];

export type ExecuteCreateCalendarEventInput = {
  googleEventId: string;
  event: CalendarEventInput;
};

export type CalendarEventExecutionResult =
  | { status: 'created' }
  | { status: 'already_exists' }
  | { status: 'unauthorized' }
  | { status: 'error' };

// Payload mínimo aceito pela Calendar API — EXATAMENTE estes campos,
// nunca attendees/conferenceData/recurrence/location/colorId/visibility/
// etc. `description` é omitida do JSON (nunca `null`) quando ausente —
// `?? undefined` faz `JSON.stringify` descartar a chave inteira.
// `reminders.overrides[0].minutes` é o literal `30`, nunca
// `event.reminderMinutesBeforeStart` — a V1 nunca envia um valor
// configurável ao Google, mesmo já validado como sempre-30 abaixo.
function buildGoogleEventPayload(googleEventId: string, event: CalendarEventInput) {
  return {
    id: googleEventId,
    summary: event.title,
    description: event.description ?? undefined,
    start: {
      dateTime: event.start,
      timeZone: event.timezone,
    },
    end: {
      dateTime: event.end,
      timeZone: event.timezone,
    },
    reminders: {
      useDefault: false,
      overrides: [
        {
          method: 'popup',
          minutes: 30,
        },
      ],
    },
  };
}

export async function executeCreateCalendarEvent(
  input: ExecuteCreateCalendarEventInput,
): Promise<CalendarEventExecutionResult> {
  const { googleEventId, event } = input;

  // Validação defensiva ANTES de qualquer chamada ao Google — zero fetch
  // para input inválido. Reaproveita o MESMO validador estrutural de
  // `runtime-state-validation.ts`, nunca uma segunda regra divergente.
  if (!isValidGoogleEventId(googleEventId)) {
    return { status: 'error' };
  }
  if (!isValidProposedCalendarEventEvent(event)) {
    return { status: 'error' };
  }

  const accessToken = await getGoogleCalendarAccessToken();
  if (!accessToken) {
    // Sem credencial válida — mesma família de "unauthorized" que um 401
    // do próprio Google (ver "unauthorized: só 401 e falha em obter
    // access token" no cabeçalho do arquivo).
    return { status: 'unauthorized' };
  }

  const body = buildGoogleEventPayload(googleEventId, event);

  let response: Response;
  try {
    response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    return { status: 'error' };
  }

  // Decisão feita SOMENTE pelo status HTTP — o corpo da resposta nunca é
  // lido, nem em sucesso nem em erro (ver cabeçalho do arquivo).
  if (response.status === 200 || response.status === 201) {
    return { status: 'created' };
  }
  if (response.status === 409) {
    // Sucesso idempotente — ver "409 é sucesso idempotente" no cabeçalho.
    // Nunca uma segunda chamada (GET) para confirmar, nunca um novo id.
    return { status: 'already_exists' };
  }
  if (response.status === 401) {
    return { status: 'unauthorized' };
  }
  // 403 (e qualquer outro status não coberto acima) -> error, nunca
  // unauthorized — ver "unauthorized: só 401 e falha em obter access
  // token" no cabeçalho do arquivo.
  return { status: 'error' };
}
