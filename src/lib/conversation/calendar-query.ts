import 'server-only';

import type { StructuredIntent } from './types';
import { getGoogleCalendarBusyTimes } from '../google/calendar';
import { isValidTimeZone, getCivilDateInTimeZone, addCivilDays, resolveCivilDateTimeInTimeZone } from './timezone';

// ============================================================================
// Calendar query — a menor fatia read-only de `query_calendar` em /conversa.
//
// Este módulo é CONSULTA, nunca ação: `query_calendar` NUNCA passa por
// `ProposedAction`/`ProposalState`/Confirmation Policy/`proposal-turn.ts`/
// Execution (ver relatório de mapeamento da subfase correspondente).
// `ProposedAction` continua com exatamente 1 variante (`create_local_task`)
// — nada aqui cria uma segunda.
//
// Escopo EXATO desta entrega (não ampliar silenciosamente):
// - só `temporalWindow.resolved.kind === 'relative_day'` (today/tomorrow,
//   hora civil opcional) é suportado. `fixed`/`anchored_start` (timezone
//   assumido pela LLM, nunca verificável — ver mapeamento, achado P),
//   `next_free_slot` (busca de horário, não é leitura simples) e
//   `relative_to_event` (exigiria resolver um evento do Calendar, sem
//   mecanismo hoje) sempre retornam `unsupported_window`;
// - zero nome/descrição/participante/local de evento — `freeBusy.query`
//   (getGoogleCalendarBusyTimes) nunca devolve isso, não é uma escolha de
//   escopo, é um limite da API;
// - zero sugestão de horário/busca de próximo horário livre;
// - zero segunda chamada a LLM — resposta inteiramente determinística a
//   partir de contagens/booleanos;
// - zero resolvedor novo de clarificação de `temporal_window` —
//   `orchestration.ts` continua sem um `case 'temporal_window'` em
//   `resolveClarificationTurn`; se uma pergunta vaga ("Como está minha
//   agenda?") for clarificada, a resposta do usuário ainda cai no
//   `unsupported` terminal já existente (limitação pré-existente,
//   registrada no mapeamento, não corrigida aqui);
// - zero write de Calendar — só `getGoogleCalendarBusyTimes`, reaproveitado
//   EXATAMENTE como está, sem nenhuma alteração em `../google/calendar`
//   (OAuth/refresh/token storage/error collapsing permanecem intocados).
//
// --- Timezone: o requisito central de correção desta fatia ---------------
//
// O NLU (intent-extraction.ts) nunca recebe o timezone do usuário — só um
// `now` em UTC — por isso `relative_day` deliberadamente preserva dia/hora
// em forma CIVIL, sem conversão prematura (ver comentário de
// `TemporalWindow` em types.ts). A conversão para instante absoluto só é
// segura AQUI, de posse do timezone real do browser (capturado em
// `ConversationPanel.tsx` via `Intl.DateTimeFormat().resolvedOptions().
// timeZone`, propagado por `sendConversationMessage` → `conversation-entry`
// → `conversation-turn` → este módulo, nunca confiado a partir do servidor).
// Timezone é contexto do cliente, não dado de autorização — nunca usado
// para decidir identidade/permissão, só para aritmética de data.
//
// Validação: string não vazia + aceita por `Intl.DateTimeFormat`
// (`isValidTimeZone`, extraído para `./timezone` — reaproveitado
// byte-a-byte por `calendar-event-proposal.ts`, nenhuma segunda
// implementação). Timezone inválida/ausente NUNCA lança nem executa a
// consulta ao Calendar — cai em `unsupported_window`, o mesmo status
// genérico de "esta janela eu não sei
// responder ainda", sem inventar um status novo só para isso.
//
// --- Resolução dia/hora → instante absoluto -------------------------------
//
// `resolveCivilDateTimeInTimeZone`/`getCivilDateInTimeZone`/`addCivilDays`
// (`./timezone.ts`) — a ÚNICA implementação de conversão civil → instante
// usada pelo projeto (auditoria da subfase de Calendar, Subfase 1: a
// técnica anterior, duplicada aqui e em `planning-context.ts`, produzia
// horário errado por 1h em dias de transição de horário de verão). Nunca
// reimplementada localmente — este módulo só compõe o resultado.
//
// --- Google call: exatamente 1 por consulta -------------------------------
//
// `getGoogleCalendarBusyTimes` é chamado NO MÁXIMO 1 vez por chamada a
// `resolveCalendarQuery` — nunca para timezone inválida, nunca para uma
// janela `unsupported_window`. Nenhum retry, nenhuma segunda chamada para
// "confirmar".
// ============================================================================

export type CalendarQueryResult =
  | { status: 'available'; scope: 'day' | 'hour' }
  | { status: 'busy'; scope: 'day' | 'hour'; busyBlockCount: number }
  | { status: 'unsupported_window' }
  | { status: 'error' };

// Narrowing explícito, nunca `as` — mesmo intent, só restrito ao
// `intentType` que este módulo entende. O chamador (`conversation-turn.ts`)
// já verifica `intent.intentType === 'query_calendar'` antes de chamar esta
// função; este alias só nomeia o tipo resultante dessa checagem.
type QueryCalendarIntent = Extract<StructuredIntent, { intentType: 'query_calendar' }>;

type ResolvedWindow = { start: Date; end: Date; scope: 'day' | 'hour' };

// `time === null` -> dia civil inteiro (scope 'day'). `time` presente ->
// janela fixa de 1h a partir do horário pedido (scope 'hour') — nunca busca
// o próximo horário livre, nunca amplia a janela. `null` (em vez de uma
// exceção) quando o dia civil ou a hora civil pedida não podem ser
// resolvidos com segurança nesse timezone (meia-noite ou horário
// inexistente/ambíguo numa transição de horário de verão) — mapeado pelo
// chamador para `unsupported_window`, o mesmo status genérico já usado
// para qualquer janela que este módulo não sabe responder ainda; nunca um
// palpite.
function resolveRelativeDayWindow(
  now: Date,
  timeZone: string,
  day: 'today' | 'tomorrow',
  time: { hour: number; minute: number } | null,
): ResolvedWindow | null {
  const today = getCivilDateInTimeZone(now, timeZone);
  const civilDay = day === 'today' ? today : addCivilDays(today, 1);

  if (time === null) {
    const nextCivilDay = addCivilDays(civilDay, 1);
    const startResolution = resolveCivilDateTimeInTimeZone(civilDay.year, civilDay.month, civilDay.day, 0, 0, timeZone);
    const endResolution = resolveCivilDateTimeInTimeZone(
      nextCivilDay.year,
      nextCivilDay.month,
      nextCivilDay.day,
      0,
      0,
      timeZone,
    );
    if (startResolution.status !== 'resolved' || endResolution.status !== 'resolved') {
      return null;
    }
    return { start: startResolution.utc, end: endResolution.utc, scope: 'day' };
  }

  const startResolution = resolveCivilDateTimeInTimeZone(
    civilDay.year,
    civilDay.month,
    civilDay.day,
    time.hour,
    time.minute,
    timeZone,
  );
  if (startResolution.status !== 'resolved') {
    return null;
  }
  const end = new Date(startResolution.utc.getTime() + 60 * 60_000);
  return { start: startResolution.utc, end, scope: 'hour' };
}

// Único ponto de entrada. Nunca formata texto de UI (ver presentation-ui.ts)
// — só produz o resultado estruturado mínimo.
export async function resolveCalendarQuery(
  intent: QueryCalendarIntent,
  now: number,
  timezone: string,
): Promise<CalendarQueryResult> {
  if (!isValidTimeZone(timezone)) {
    return { status: 'unsupported_window' };
  }

  const resolved = intent.temporalWindow.resolved;
  if (resolved.kind !== 'relative_day') {
    return { status: 'unsupported_window' };
  }

  const nowDate = new Date(now);
  if (Number.isNaN(nowDate.getTime())) {
    return { status: 'error' };
  }

  const window = resolveRelativeDayWindow(nowDate, timezone, resolved.day, resolved.time);
  if (window === null) {
    // Dia/hora civil não resolvível com segurança (meia-noite ou horário
    // inexistente/ambíguo numa transição de horário de verão) — nunca um
    // palpite, mesmo status genérico já usado para qualquer janela que
    // este módulo não sabe responder.
    return { status: 'unsupported_window' };
  }

  const busyBlocks = await getGoogleCalendarBusyTimes(window.start.toISOString(), window.end.toISOString());

  if (busyBlocks === null) {
    // Calendar não conectado e falha técnica continuam indistinguíveis
    // aqui, de propósito (ver seção 24 do enunciado desta subfase):
    // `getGoogleCalendarBusyTimes` já colapsa os dois em `null`, e esta
    // fatia não amplia essa função para distingui-los.
    return { status: 'error' };
  }

  if (busyBlocks.length === 0) {
    return { status: 'available', scope: window.scope };
  }

  return { status: 'busy', scope: window.scope, busyBlockCount: busyBlocks.length };
}
