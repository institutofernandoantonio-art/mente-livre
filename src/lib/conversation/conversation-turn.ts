import 'server-only';

import type { StructuredIntent } from './types';
import { createConversationState } from './state';
import { buildProposedAction } from './proposed-action';
import type { ProposedAction } from './proposed-action';
import { buildCreateCalendarEventAction, type CreateEventIntent } from './calendar-event-proposal';
import { checkCalendarEventAvailability } from './calendar-event-availability';
import { createProposalState, type ProposalState } from './proposal-state';
import { resolveClarificationTurn } from './orchestration';
import { resolveCalendarQuery, type CalendarQueryResult } from './calendar-query';
import {
  getRuntimeState,
  replaceRuntimeState,
  advanceRuntimeState,
  consumeRuntimeState,
} from './runtime-state-storage';
import type { RuntimeStateAdvanceResult } from './runtime-state-storage';

// ============================================================================
// Conversation turn — o integrador que conecta orchestration/proposed-action/
// proposal-state ao storage server-side, para o primeiro turno e para a
// continuação de uma clarificação já ativa.
//
// Nome escolhido deliberadamente distinto de `orchestration.ts` (resolve só
// a LÓGICA de um turno, nunca persiste) e de `runtime-state-storage.ts`
// (persiste só o que já foi decidido, nunca sabe o que é StructuredIntent) —
// "conversation-turn" nomeia exatamente a responsabilidade nova: COORDENAR
// um turno de ponta a ponta (ler → decidir com os módulos puros já
// existentes → persistir via CAS), sem duplicar nenhuma regra deles.
//
// Este módulo NUNCA:
// - decide clarificação (`clarification.ts`, via `createConversationState`/
//   `resolveClarificationTurn`, que já fazem isso);
// - decide materialização de proposta (`proposed-action.ts`);
// - constrói/expira ProposalState sozinho (`proposal-state.ts`);
// - consulta Supabase diretamente — toda persistência passa por
//   `runtime-state-storage.ts`;
// - implementa Confirmation Policy — ao encontrar `kind === 'proposal'`,
//   este módulo PARA ali e devolve `proposal_pending`, nunca interpreta
//   "sim"/"não"/"confirma"/"ok"/"manda"/"faz";
// - implementa Execution — nenhum insert em `items`, nenhuma chamada de
//   Calendar, nenhuma execução de `ProposedAction`. Uma proposta persistida
//   continua sendo só intenção materializada aguardando confirmação futura.
//
// Imports normais e estáticos das dependências reais — sem parâmetro de
// injeção, sem `import()` dinâmico condicionado a ambiente de teste. A
// API pública tem exatamente os argumentos conceituais já aprovados
// (`intent`/`now`/`expirations` e `answer`/`now`/`expirations`), nada
// exposto só para viabilizar teste — a infraestrutura de teste (ver
// `tests/support/`) resolve isso inteiramente por fora deste arquivo, via
// um hook de resolução de módulos do Node que redireciona, só durante os
// testes, `./runtime-state-storage`/`./orchestration` para dublês —
// código de produção nunca muda de forma para acomodar um test runner.
//
// --- `ConversationExpirations`: dois TTLs, nunca um só ---------------------
//
// Correção de um gap real identificado no mapeamento da subfase anterior:
// um único `expiresAt` não consegue expressar simultaneamente a política
// V1 (24h para clarificação, 30min para proposta — ver
// conversation-ttl.ts), porque QUAL dos dois caminhos será tomado só é
// decidido DEPOIS que o argumento já foi passado (o resultado de
// `createConversationState`/`evaluateClarification`/orchestration só é
// conhecido em runtime). `conversation-turn.ts` continua sem saber nada
// sobre a POLÍTICA em si — não importa `conversation-ttl.ts`, não calcula
// nada, só recebe os dois timestamps absolutos já prontos do caller (a
// futura camada de entry/dispatcher) e escolhe o campo certo para cada
// chamada de construtor, exatamente como já fazia com um valor só.
//
// --- REPLACE vs ADVANCE: regra central herdada do mapeamento anterior -----
//
// Criação inicial (nenhum runtime state ativo: `not_found`/`expired`) usa
// SEMPRE `replaceRuntimeState`. Continuação de um state JÁ ativo (`found`)
// usa SEMPRE `advanceRuntimeState`, nunca `replace` por conveniência — usar
// replace ali jogaria fora a proteção de CAS exatamente no caminho mais
// sensível a concorrência (uma resposta stale de outro device sobrescreveria
// silenciosamente um state mais novo). Nenhuma exceção é implementada aqui.
//
// --- CONSUME: terminal sem sucessor (correção do gap de residual) ---------
//
// Gap real identificado e corrigido nesta subfase: três status produzidos
// dentro de `resolveClarificationConversationalTurn` são SEMANTICAMENTE
// TERMINAIS — nenhuma resposta futura do usuário pode transformar o MESMO
// `pendingIntent` já persistido em algo materializável sem um novo turno
// de NLU — mas antes desta correção eram devolvidos sem nenhuma escrita,
// deixando a clarification row intacta (até 24h de TTL) e fazendo TODA
// mensagem seguinte continuar sendo tratada como resposta à mesma pergunta
// zumbi, mesmo sendo um pedido novo e completamente não relacionado:
//
// - orchestration `unsupported` (nenhum resolver para o `field` pendente,
//   ou uma referência estruturalmente impossível — ver orchestration.ts);
// - builder `unsupported` (`buildProposedAction`: `intentType` que nunca
//   materializa, ex. `conversational_question`);
// - builder `not_materializable` (`buildProposedAction`: `create_task` com
//   `temporalWindow`/`deadline`/`duration` não resolvidos o suficiente).
//
// Os três agora chamam `consumeRuntimeState(expectedStateId, now)` — o
// MESMO `expectedStateId` já obtido do `getRuntimeState(now)` desta mesma
// execução, nunca um novo id gerado/aceito/relido — antes de retornar,
// via o helper `consumeAndReturn` abaixo. Resultado externo em caso de
// sucesso (`consumed`) permanece EXATAMENTE o status terminal original
// (`unsupported`/`not_materializable`) — o consume nunca é revelado ao
// chamador. `conflict` (outra requisição já avançou/consumiu a mesma row
// entre a leitura e este ponto) e `error` seguem a mesma disciplina
// anti-TOCTOU já usada em `translateAdvanceResult`: zero retry, zero
// requery, zero fallback para `replace`.
//
// NUNCA consomem (permanecem exatamente como antes desta correção,
// porque uma resposta futura genuinamente pode mudar o resultado):
// `ambiguous`, `unrecognized`, `reference_not_found` (not_found da
// Reference Resolution), `error` (falha técnica, não terminal de
// domínio). `awaiting_clarification` e `ready` -> `proposed` continuam
// usando exclusivamente `advanceRuntimeState` — nunca consomem, porque
// ambos têm um PRÓXIMO estado real a persistir.
//
// --- query_calendar: CONSULTA, nunca ProposedAction (subfase de leitura
// read-only do Calendar) ---------------------------------------------------
//
// Antes de chamar `buildProposedAction` num intent `ready`, este módulo
// agora desvia `intentType === 'query_calendar'` para `calendar-query.ts`
// — nunca para `buildProposedAction`/`ProposalState`/Confirmation Policy/
// `proposal-turn.ts`/Execution. `ProposedAction` continua com exatamente 1
// variante (`create_local_task`); `query_calendar` nunca se torna uma.
//
// Uma consulta já resolvida no primeiro turno é 100% stateless: zero
// `replaceRuntimeState` — não há nada a aguardar depois da resposta. Uma
// consulta que só fica `ready` DEPOIS de uma clarificação (hoje só possível
// via a resolução de `event_reference`, já suportada por
// `orchestration.ts` — `temporal_window` continua sem resolvedor de
// resposta, ver clarification.ts/orchestration.ts) é TERMINAL, sem
// sucessor: usa `consumeAndReturn`, exatamente o mesmo mecanismo já
// corrigido para os terminais `unsupported`/`not_materializable` (ver
// "CONSUME" abaixo) — zero mudança em `runtime-state-storage.ts`.
//
// `timezone` (novo parâmetro nas duas funções públicas) é contexto do
// cliente, nunca dado de autorização — propagado só até `calendar-query.ts`
// (a única camada que precisa resolver `relative_day`), nunca usado para
// nada além de aritmética de data. Timezone inválida nunca aborta o turno
// inteiro: `calendar-query.ts` já trata isso, devolvendo
// `unsupported_window` (ver aquele arquivo).
//
// --- stateId vs proposalId --------------------------------------------
//
// `stateId` (identidade de versão de storage, usada só para CAS) NUNCA é
// gerado aqui — vem exclusivamente do wrapper devolvido por
// `getRuntimeState`, permanece só nesta camada server-side, e nunca faz
// parte de nenhum resultado exposto por este módulo. `proposalId`
// (identidade lógica da proposta, usada pela futura Confirmation Policy) é
// gerado aqui, de forma independente, via `crypto.randomUUID()` — nunca
// reaproveitando o `stateId`.
//
// --- Vocabulário de saída: evitando a colisão `not_found` -------------
//
// `ClarificationTurnPersistenceResult` usa `no_active_runtime_state` para
// "não existe runtime state" (equivalente ao `not_found` de
// `RuntimeStateReadResult`) e `reference_not_found` para "referência a
// evento/tarefa não encontrada" (equivalente ao `not_found` de
// `ClarificationTurnResult`, da Reference Resolution) — os dois nomes de
// `not_found` do resto da pilha nunca aparecem juntos sob o mesmo rótulo
// aqui, exatamente para não confundir um com o outro.
//
// --- create_event: materialização + freeBusy ANTES de propor (Subfase 2
// da criação de compromissos no Google Calendar) -----------------------
//
// Espelha exatamente o desvio já existente de `query_calendar` (ver acima)
// — `create_event` também nunca passa por `buildProposedAction`: usa
// `attemptCreateEvent()` (privada, abaixo), que chama SEMPRE
// `buildCreateCalendarEventAction(intent, now, timezone)` (Subfase 1,
// `./calendar-event-proposal.ts`) e, só se o resultado for `built`,
// `checkCalendarEventAvailability(start, end)` (`./calendar-event-
// availability.ts`) — a MESMA janela `[start, end]` do `ProposedAction`
// materializado, nunca arredondada/ampliada, nunca uma segunda busca de
// horário. Nenhuma lógica temporal é reimplementada aqui — este módulo só
// orquestra a ORDEM (build → freeBusy → decidir) e a PERSISTÊNCIA
// (replace no primeiro turno, advance+CAS na clarificação), exatamente
// como já faz para `create_task`.
//
// Mapeamento de status do builder (documentado aqui por ser uma decisão
// desta subfase, não do builder em si — ver `attemptCreateEvent`):
// - `not_materializable` E `invalid` colapsam no MESMO status externo já
//   existente `not_materializable`. `invalid` (dois fatos já resolvidos do
//   intent que se contradizem, ver calendar-event-proposal.ts) tecnicamente
//   carrega uma causa mais forte que "falta informação", mas o resultado
//   prático é idêntico (não dá para propor nada agora, sem inventar dado)
//   e, ao contrário de um `error` técnico/transiente, o problema é do
//   PRÓPRIO intent — uma nova resposta nunca "conserta" o mesmo intent
//   contraditório, então precisa ser TERMINAL (consumido na clarificação),
//   exatamente como `not_materializable` já é. Reaproveitar `error` para
//   isso quebraria o significado já estabelecido desse status neste
//   arquivo (falha técnica, NUNCA consumida) — por isso os dois builder-
//   failures colapsam no status já existente, em vez de um nome novo ou
//   de `error`.
// - `busy` do freeBusy vira `schedule_conflict`: zero ProposalState, zero
//   escrita de runtime no primeiro turno; TERMINAL (consome) na
//   clarificação — a proposta já foi tentada e rejeitada por um fato
//   externo (agenda ocupada), não por falta de informação; não há
//   resolvedor de "tente outro horário" nesta subfase (fora de escopo:
//   `temporal_window` clarification).
// - `unavailable` (freeBusy retornou null/erro) vira `calendar_unavailable`:
//   zero write no primeiro turno (mesmo tratamento de `schedule_conflict`
//   ali) — mas na clarificação é deliberadamente TRANSITÓRIO, não
//   terminal: nunca `consumeAndReturn`, nunca `advanceRuntimeState`, nunca
//   `replaceRuntimeState`. É uma falha TÉCNICA de rede/infra no momento da
//   consulta, não uma decisão semântica sobre o pedido do usuário — a
//   clarification row original (com o `pendingIntent` já resolvido pela
//   resposta que acabou de chegar) precisa sobreviver intacta, exatamente
//   como já chegou de `getRuntimeState` neste turno, para que o MESMO
//   texto de resposta ("1 hora") possa ser reenviado depois, quando o
//   Calendar voltar, sem o usuário precisar repetir a mensagem inteira.
//   Nenhuma versão parcialmente resolvida do intent é persistida aqui —
//   a row simplesmente não é tocada nesta subfase. Nunca assumido como
//   livre nem como ocupado; zero retry/requery dentro do mesmo turno.
// - Corrida (freeBusy livre, mas o `replace`/`advance` final devolve
//   `conflict`): tratado pelo MESMO `translateAdvanceResult`/checagem de
//   `saved` já usados por `create_task` — `conflict` nunca dispara uma
//   segunda consulta ao Calendar nem um novo `build`, mesma disciplina
//   anti-TOCTOU de sempre.
//
// Este módulo continua NUNCA chamando a API do Google diretamente —
// `checkCalendarEventAvailability` é a única fronteira, e ela reaproveita
// `getGoogleCalendarBusyTimes` exatamente como já está (zero escopo OAuth
// novo, zero admin/service-role novo). Nenhum evento é criado nesta
// subfase — `proposal-turn.ts` continua sem qualquer Calendar write.
// ============================================================================

// --- Resultados públicos -------------------------------------------------
//
// Dois result types, não um único mega-union: os dois fluxos têm
// vocabulários de saída genuinamente diferentes (ex.: `already_active` só
// faz sentido no primeiro turno; `conflict`/`proposal_pending` só no turno
// de clarificação) — misturar os dois recriaria exatamente o anti-padrão de
// "estados impossíveis por operação" que o resto desta pilha (ver os 4
// result types de runtime-state-storage.ts) já evita deliberadamente.

// `clarification_saved`/`proposal_saved` carregam dado mínimo de
// apresentação — sempre extraído do MESMO objeto em memória que já foi
// (ou está prestes a ser, no mesmo await) persistido, nunca de uma
// releitura de runtime nem de uma reconstrução paralela:
//
// - `question`: `currentQuestion.text` da `ConversationState` recém-
//   criada/avançada. Só a string (nunca o `ClarificationQuestion` inteiro
//   nem `field`) — texto 100% determinístico e genérico por campo (ver
//   clarification-questions.ts: "nunca personalizada com conteúdo do
//   intent... para nunca arriscar vazar conteúdo real"), nunca derivado
//   de dado do usuário. Presente SÓ quando a escrita (`replace`/`advance`)
//   já confirmou sucesso — nunca antecipado, nunca presente em `conflict`.
// - `action`: o próprio `ProposedAction` retornado por
//   `buildProposedAction` (mesma referência que originou a
//   `ProposalState` persistida, nunca reconstruído). Shape real
//   (proposed-action.ts) não contém `proposalId`/`userId`/`stateId`/
//   nenhum identificador interno — só `actionType` e `task` (title/
//   description/deadline/duration), dado de domínio já seguro para uma
//   futura camada de apresentação. Presente SÓ após escrita bem-sucedida.

// `ConversationExpirations`: só os dois timestamps absolutos — nunca
// `userId`/`stateId`/`proposalId`/client/payload de runtime. Quem monta
// este objeto (a futura camada de entry) é responsável por gerá-los (ex.:
// via `getClarificationExpiresAt(now)`/`getProposalExpiresAt(now)` de
// conversation-ttl.ts) — este módulo só consome.
export type ConversationExpirations = {
  clarificationExpiresAt: number;
  proposalExpiresAt: number;
};

export type FirstTurnResult =
  | { status: 'clarification_saved'; question: string }
  | { status: 'proposal_saved'; action: ProposedAction }
  | { status: 'calendar_information'; result: CalendarQueryResult }
  | { status: 'schedule_conflict' }
  | { status: 'calendar_unavailable' }
  | { status: 'already_active' }
  | { status: 'unsupported' }
  | { status: 'not_materializable' }
  | { status: 'error' };

export type ClarificationTurnPersistenceResult =
  | { status: 'clarification_saved'; question: string }
  | { status: 'proposal_saved'; action: ProposedAction }
  | { status: 'calendar_information'; result: CalendarQueryResult }
  | { status: 'schedule_conflict' }
  | { status: 'calendar_unavailable' }
  | { status: 'no_active_runtime_state' }
  | { status: 'runtime_expired' }
  | { status: 'proposal_pending' }
  | { status: 'ambiguous' }
  | { status: 'unrecognized' }
  | { status: 'reference_not_found' }
  | { status: 'unsupported' }
  | { status: 'not_materializable' }
  | { status: 'conflict' }
  | { status: 'error' };

// --- create_event: build + freeBusy, sem decidir persistência --------------
//
// Compartilhado por primeiro turno e clarificação — as DUAS únicas
// diferenças entre eles (replace vs advance/consume) ficam nos call sites
// abaixo, nunca aqui. Ver "create_event: materialização + freeBusy" no
// cabeçalho do arquivo para o racional completo de cada status.
type CreateEventAttemptResult =
  | { status: 'not_materializable' }
  | { status: 'schedule_conflict' }
  | { status: 'calendar_unavailable' }
  // Só a guarda de tipo estruturalmente inalcançável abaixo — nunca o
  // builder-invalid (que colapsa em not_materializable, ver cabeçalho).
  | { status: 'error' }
  | { status: 'available'; action: Extract<ProposedAction, { actionType: 'create_calendar_event' }> };

// --- Diagnóstico TEMPORÁRIO — Subfase 15 -----------------------------------
//
// Instrumentação mínima e temporária para investigar uma divergência real
// de produção (freeBusy consultado diretamente no calendário mostrou
// `busy: []` para a mesma janela que `create_event` classificou como
// `busy`). Exceção DELIBERADA à disciplina "nunca console.*" já seguida em
// outros módulos desta mesma pasta (cada um documenta "Este módulo NUNCA
// ... usa `console.*`" no próprio cabeçalho) — nenhum desses outros
// módulos foi tocado por esta subfase; só este único ponto, em
// `conversation-turn.ts`, e só até o diagnóstico ser resolvido (remover
// depois, junto com este comentário).
//
// Prefixo `[calendar-create-debug]` para localização fácil nos logs do
// Vercel. Campos SEMPRE seguros por construção — nunca texto do usuário,
// título, descrição, `user_id`, `stateId`/`proposalId`/`googleEventId`,
// token, cookie, `Authorization`, ou payload bruto do Google:
// - `dispatcherPath`: qual call site chamou (nunca inferido, sempre
//   passado explicitamente pelo chamador);
// - `intentType`: sempre `'create_event'` aqui (o único intentType que
//   `attemptCreateEvent` recebe) — incluído mesmo assim, por clareza no
//   log, nunca por necessidade de branch;
// - `temporalKind`/`relativeDay`/`hour`/`minute`: lidos diretamente do
//   `TemporalWindow.resolved` já presente no intent (o mesmo já validado
//   pelo guard determinístico da Subfase 13) — nunca uma segunda
//   interpretação de texto;
// - `durationMinutes`: só o número, nunca o objeto `Duration` inteiro
//   (que poderia um dia carregar mais campos);
// - `materializedStart`/`materializedEnd`/`timezone`: exatamente o que
//   `buildCreateCalendarEventAction` produziu, só disponível quando
//   `status: 'built'`;
// - `availabilityStatus`: o `status` de `checkCalendarEventAvailability`
//   (nunca os `busyBlocks` em si — essa função já os esconde por design,
//   ver cabeçalho de calendar-event-availability.ts; `busyBlockCount`
//   pedido no enunciado desta subfase permanece `null` porque essa
//   função não expõe contagem nenhuma, e este diagnóstico NÃO altera
//   `calendar-event-availability.ts` para inventar uma).
//
// Zero persistência em banco, zero tabela nova, zero retorno ao browser
// (`CreateEventAttemptResult`, o tipo de retorno real da função, é
// idêntico ao de antes desta subfase — só o `console.info` foi
// adicionado, nenhum campo novo em nenhum tipo de retorno).
type CalendarCreateDebugDispatcherPath = 'nlu_first_turn' | 'clarification_turn';

type CalendarCreateDebugFields = {
  dispatcherPath: CalendarCreateDebugDispatcherPath;
  intentType: 'create_event';
  temporalKind: CreateEventIntent['temporalWindow']['resolved']['kind'];
  relativeDay: 'today' | 'tomorrow' | null;
  hour: number | null;
  minute: number | null;
  durationMinutes: number | null;
  materializedStart: string | null;
  materializedEnd: string | null;
  timezone: string;
  availabilityStatus: 'available' | 'busy' | 'unavailable' | null;
  busyBlockCount: null;
};

function logCalendarCreateDebug(fields: CalendarCreateDebugFields): void {
  console.info('[calendar-create-debug]', JSON.stringify(fields));
}

async function attemptCreateEvent(
  intent: CreateEventIntent,
  now: number,
  timezone: string,
  dispatcherPath: CalendarCreateDebugDispatcherPath,
): Promise<CreateEventAttemptResult> {
  const resolved = intent.temporalWindow.resolved;
  const debugBase: Omit<CalendarCreateDebugFields, 'materializedStart' | 'materializedEnd' | 'availabilityStatus'> = {
    dispatcherPath,
    intentType: 'create_event',
    temporalKind: resolved.kind,
    relativeDay: resolved.kind === 'relative_day' ? resolved.day : null,
    hour: resolved.kind === 'relative_day' && resolved.time !== null ? resolved.time.hour : null,
    minute: resolved.kind === 'relative_day' && resolved.time !== null ? resolved.time.minute : null,
    durationMinutes:
      intent.duration !== null && intent.duration.source !== 'unresolved' ? intent.duration.value.minutes : null,
    timezone,
    busyBlockCount: null,
  };

  const buildResult = buildCreateCalendarEventAction(intent, now, timezone);

  if (buildResult.status === 'not_materializable' || buildResult.status === 'invalid') {
    logCalendarCreateDebug({ ...debugBase, materializedStart: null, materializedEnd: null, availabilityStatus: null });
    return { status: 'not_materializable' };
  }

  const { action } = buildResult;
  if (action.actionType !== 'create_calendar_event') {
    // Estruturalmente inalcançável: buildCreateCalendarEventAction só
    // constrói esta variante quando status é 'built' — guarda de tipo
    // exigida só porque o retorno é tipado como ProposedAction (a união
    // inteira), nunca a variante já estreitada.
    logCalendarCreateDebug({ ...debugBase, materializedStart: null, materializedEnd: null, availabilityStatus: null });
    return { status: 'error' };
  }

  const debugWithMaterialization = {
    ...debugBase,
    materializedStart: action.event.start,
    materializedEnd: action.event.end,
  };

  // Janela EXATA do ProposedAction materializado — nunca arredondada,
  // nunca ampliada, nunca uma segunda busca por outro horário.
  const availability = await checkCalendarEventAvailability(action.event.start, action.event.end);

  logCalendarCreateDebug({ ...debugWithMaterialization, availabilityStatus: availability.status });

  switch (availability.status) {
    case 'busy':
      return { status: 'schedule_conflict' };
    case 'unavailable':
      return { status: 'calendar_unavailable' };
    case 'available':
      return { status: 'available', action };
  }
}

// --- Primeiro turno (sem runtime state ainda) -------------------------

// Nunca aceita userId/claims/Supabase client/stateId externo.
export async function resolveFirstConversationalTurn(
  intent: StructuredIntent,
  now: number,
  expirations: ConversationExpirations,
  timezone: string,
): Promise<FirstTurnResult> {
  const current = await getRuntimeState(now);
  if (current.status === 'error') {
    return { status: 'error' };
  }
  if (current.status === 'found') {
    // Já existe runtime state ativo — nunca sobrescrever silenciosamente,
    // nunca usar replace por conveniência (ver REPLACE vs ADVANCE acima).
    return { status: 'already_active' };
  }
  // current.status é 'not_found' ou 'expired': nada ativo a preservar —
  // criação inicial usa replace.

  const conversationState = createConversationState(intent, now, expirations.clarificationExpiresAt);

  if (conversationState !== null) {
    const saved = await replaceRuntimeState({ kind: 'clarification', state: conversationState }, now);
    return saved.status === 'saved'
      ? { status: 'clarification_saved', question: conversationState.currentQuestion.text }
      : { status: 'error' };
  }

  // createConversationState devolveu null: a intenção já está `ready`.

  if (intent.intentType === 'query_calendar') {
    // Consulta, não proposta — ver "query_calendar: CONSULTA" no cabeçalho.
    // Zero write de runtime: nada fica pendente depois desta resposta.
    const result = await resolveCalendarQuery(intent, now, timezone);
    return { status: 'calendar_information', result };
  }

  if (intent.intentType === 'create_event') {
    const attempt = await attemptCreateEvent(intent, now, timezone, 'nlu_first_turn');

    switch (attempt.status) {
      case 'not_materializable':
        return { status: 'not_materializable' };
      case 'error':
        return { status: 'error' };
      case 'schedule_conflict':
        return { status: 'schedule_conflict' };
      case 'calendar_unavailable':
        return { status: 'calendar_unavailable' };
      case 'available': {
        const proposalId = crypto.randomUUID();
        const proposalState: ProposalState = createProposalState(
          attempt.action,
          proposalId,
          now,
          expirations.proposalExpiresAt,
        );
        const saved = await replaceRuntimeState({ kind: 'proposal', state: proposalState }, now);
        return saved.status === 'saved'
          ? { status: 'proposal_saved', action: attempt.action }
          : { status: 'error' };
      }
    }
  }

  const buildResult = buildProposedAction(intent);

  switch (buildResult.status) {
    case 'unsupported':
      return { status: 'unsupported' };
    case 'not_materializable':
      return { status: 'not_materializable' };
    case 'proposed': {
      const proposalId = crypto.randomUUID();
      const proposalState: ProposalState = createProposalState(
        buildResult.action,
        proposalId,
        now,
        expirations.proposalExpiresAt,
      );
      const saved = await replaceRuntimeState({ kind: 'proposal', state: proposalState }, now);
      return saved.status === 'saved'
        ? { status: 'proposal_saved', action: buildResult.action }
        : { status: 'error' };
    }
  }
}

// --- Turno de clarificação (runtime state já ativo) ---------------------

export async function resolveClarificationConversationalTurn(
  answer: string,
  now: number,
  expirations: ConversationExpirations,
  timezone: string,
): Promise<ClarificationTurnPersistenceResult> {
  const current = await getRuntimeState(now);

  switch (current.status) {
    case 'error':
      return { status: 'error' };
    case 'not_found':
      return { status: 'no_active_runtime_state' };
    case 'expired':
      return { status: 'runtime_expired' };
    case 'found':
      break;
  }

  if (current.value.kind === 'proposal') {
    // Confirmation Policy ainda não existe. Este integrador NUNCA
    // interpreta resposta contra uma proposta pendente — para aqui,
    // sem chamar resolveClarificationTurn, sem consumir, sem executar.
    return { status: 'proposal_pending' };
  }

  const expectedStateId = current.value.stateId;
  const turnResult = await resolveClarificationTurn(
    current.value.state,
    answer,
    now,
    expirations.clarificationExpiresAt,
  );

  switch (turnResult.status) {
    case 'expired':
      // Estruturalmente inalcançável quando o mesmo `now` é usado tanto no
      // getRuntimeState acima quanto aqui (mesmo `expiresAt` do storage e
      // do domínio) — tratado com o mesmo status de storage por segurança,
      // nunca ignorado nem transformado em outra coisa.
      return { status: 'runtime_expired' };

    case 'ambiguous':
      return { status: 'ambiguous' };

    case 'unrecognized':
      return { status: 'unrecognized' };

    case 'not_found':
      // not_found AQUI é da Reference Resolution (referência a
      // evento/tarefa não encontrada) — nunca confundir com
      // 'no_active_runtime_state' acima.
      return { status: 'reference_not_found' };

    case 'unsupported':
      // Terminal — ver "CONSUME: terminal sem sucessor" no cabeçalho.
      return consumeAndReturn(expectedStateId, now, { status: 'unsupported' });

    case 'error':
      return { status: 'error' };

    case 'awaiting_clarification': {
      const advanceResult = await advanceRuntimeState(
        expectedStateId,
        { kind: 'clarification', state: turnResult.state },
        now,
      );
      return translateAdvanceResult(advanceResult, {
        status: 'clarification_saved',
        question: turnResult.state.currentQuestion.text,
      });
    }

    case 'ready': {
      if (turnResult.intent.intentType === 'query_calendar') {
        // Terminal — mesmo mecanismo já usado para unsupported/
        // not_materializable (ver "CONSUME" no cabeçalho): esta resposta
        // não tem sucessor, a clarification row não deve sobreviver a ela.
        const result = await resolveCalendarQuery(turnResult.intent, now, timezone);
        return consumeAndReturn(expectedStateId, now, { status: 'calendar_information', result });
      }

      if (turnResult.intent.intentType === 'create_event') {
        const attempt = await attemptCreateEvent(turnResult.intent, now, timezone, 'clarification_turn');

        switch (attempt.status) {
          case 'not_materializable':
            // Terminal — ver "CONSUME: terminal sem sucessor" no cabeçalho.
            return consumeAndReturn(expectedStateId, now, { status: 'not_materializable' });
          case 'error':
            // Guarda estruturalmente inalcançável (ver attemptCreateEvent)
            // — falha técnica genuína, nunca consumida, mesma disciplina
            // já usada para `error` de orchestration neste arquivo.
            return { status: 'error' };
          case 'schedule_conflict':
            // Terminal — a proposta já foi tentada e rejeitada por um fato
            // externo (agenda ocupada); não há resolvedor de "outro
            // horário" nesta subfase.
            return consumeAndReturn(expectedStateId, now, { status: 'schedule_conflict' });
          case 'calendar_unavailable':
            // TRANSITÓRIO, nunca terminal — ver "unavailable" no
            // cabeçalho do arquivo. Zero consume, zero advance, zero
            // replace: a clarification row original (já com o
            // pendingIntent resolvido pela resposta deste turno)
            // permanece exatamente como veio de getRuntimeState, para que
            // a MESMA resposta possa ser reenviada quando o Calendar
            // voltar. Nenhuma versão parcial é persistida aqui.
            return { status: 'calendar_unavailable' };
          case 'available': {
            const proposalId = crypto.randomUUID();
            const proposalState: ProposalState = createProposalState(
              attempt.action,
              proposalId,
              now,
              expirations.proposalExpiresAt,
            );
            const advanceResult = await advanceRuntimeState(
              expectedStateId,
              { kind: 'proposal', state: proposalState },
              now,
            );
            return translateAdvanceResult(advanceResult, {
              status: 'proposal_saved',
              action: attempt.action,
            });
          }
        }
      }

      const buildResult = buildProposedAction(turnResult.intent);

      switch (buildResult.status) {
        case 'unsupported':
          // Terminal — ver "CONSUME: terminal sem sucessor" no cabeçalho.
          return consumeAndReturn(expectedStateId, now, { status: 'unsupported' });
        case 'not_materializable':
          return consumeAndReturn(expectedStateId, now, { status: 'not_materializable' });
        case 'proposed': {
          const proposalId = crypto.randomUUID();
          const proposalState: ProposalState = createProposalState(
            buildResult.action,
            proposalId,
            now,
            expirations.proposalExpiresAt,
          );
          const advanceResult = await advanceRuntimeState(
            expectedStateId,
            { kind: 'proposal', state: proposalState },
            now,
          );
          return translateAdvanceResult(advanceResult, {
            status: 'proposal_saved',
            action: buildResult.action,
          });
        }
      }
    }
  }
}

// Traduz o resultado genérico de uma escrita CAS para o vocabulário deste
// módulo. `onSuccess` já vem pronto de quem chama (com `question`/`action`
// extraídos do MESMO objeto que acabou de ser passado para o `advance`) —
// só é devolvido no ramo `advanced`; `conflict`/`error` nunca carregam
// `question`/`action`, mesmo que já tenham sido computados em memória
// antes desta chamada. `conflict` nunca dispara fallback para replace,
// nunca uma segunda escrita, nunca uma re-query só para explicar a causa
// (ver mapeamento da subfase anterior — risco de TOCTOU) — qualquer
// ProposalState/ConversationState construída apenas em memória até este
// ponto é simplesmente descartada.
function translateAdvanceResult(
  result: RuntimeStateAdvanceResult,
  onSuccess: ClarificationTurnPersistenceResult,
): ClarificationTurnPersistenceResult {
  switch (result.status) {
    case 'advanced':
      return onSuccess;
    case 'conflict':
      return { status: 'conflict' };
    case 'error':
      return { status: 'error' };
  }
}

// Espelha exatamente `translateAdvanceResult` acima, mas para os 3 pontos
// terminais-sem-sucessor documentados em "CONSUME: terminal sem sucessor"
// no cabeçalho do arquivo. `expectedStateId`/`now` são sempre os mesmos já
// recebidos/lidos por `resolveClarificationConversationalTurn` nesta
// execução — nunca um novo id gerado, aceito de fora, ou relido. `onSuccess`
// é o status terminal ORIGINAL (`unsupported`/`not_materializable`), devolvido
// só quando o consume de fato remove a row — nunca revela ao chamador que um
// consume aconteceu. `conflict`/`error` nunca disparam retry, requery, ou
// fallback para `replace`/`advance` — mesma disciplina anti-TOCTOU.
async function consumeAndReturn(
  expectedStateId: string,
  now: number,
  onSuccess: ClarificationTurnPersistenceResult,
): Promise<ClarificationTurnPersistenceResult> {
  const consumeResult = await consumeRuntimeState(expectedStateId, now);
  switch (consumeResult.status) {
    case 'consumed':
      return onSuccess;
    case 'conflict':
      return { status: 'conflict' };
    case 'error':
      return { status: 'error' };
  }
}
