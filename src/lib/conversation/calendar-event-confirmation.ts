import 'server-only';

import { hasGoogleCalendarEventWriteAuthorization } from '../google/calendar';
import { claimCalendarEventExecution } from './calendar-event-claim';
import { executeCreateCalendarEvent } from './calendar-event-execution';
import { finalizeCalendarEventExecution } from './calendar-event-finalize';
import type { ProposedAction } from './proposed-action';

// ============================================================================
// Calendar event confirmation — o pequeno orquestrador server-only que
// conecta, pela PRIMEIRA vez, a confirmação positiva ("sim") de uma
// proposta `create_calendar_event` ao lifecycle já construído nas
// Subfases 3-6:
//
//   CLAIM (calendar-event-claim.ts)
//   -> GOOGLE events.insert (calendar-event-execution.ts)
//   -> FINALIZE (calendar-event-finalize.ts)
//
// Subfase 9 da criação de compromissos no Google Calendar. Este módulo é
// IRMÃO de `local-task-execution.ts` no papel que cumpre para
// `proposal-turn.ts` (a Execution real de uma proposta confirmada), mas
// PRECISA de 3 passos em vez de 1, porque não existe (e nunca existiu)
// uma única RPC atômica que faça claim+Google+finalize juntos — Google é
// uma chamada de REDE, nunca pode viver dentro da MESMA transação
// Postgres que o claim/finalize.
//
// Subfase 10 (gate seguro para conexões antigas freebusy-only): antes de
// QUALQUER claim, este módulo pergunta a `hasGoogleCalendarEventWriteAuthorization()`
// (`../google/calendar`) se a conexão do usuário atual foi de fato
// (re)estabelecida com o consentimento completo (freebusy + escrita).
// Uma conexão antiga (criada quando o app só pedia freebusy) tem
// `event_write_enabled = false` e NUNCA chega ao claim — ver "Passo 0"
// abaixo.
//
// Este módulo NUNCA:
// - reimplementa claim/execução Google/finalize — importa e chama as três
//   abstrações reais (`claimCalendarEventExecution`/
//   `executeCreateCalendarEvent`/`finalizeCalendarEventExecution`), nunca
//   abre conexão Supabase própria, nunca chama `fetch` diretamente, nunca
//   deriva um access token;
// - aceita/deriva `userId`, access token, refresh token, `calendarId`,
//   `now`, ou qualquer dado do browser além do que já chega em
//   `ConfirmCalendarEventInput` — a identidade do usuário e o token
//   continuam inteiramente dentro de `calendar-event-execution.ts`/
//   `../google/calendar`;
// - gera um `googleEventId` — o único id usado em toda a chamada a
//   `executeCreateCalendarEvent` é EXATAMENTE o devolvido pelo claim
//   (`claimed` OU `already_claimed`), nunca um valor calculado aqui;
// - faz retry, segunda chamada, ou GET de confirmação em qualquer dos três
//   passos — cada uma das três abstrações é chamada NO MÁXIMO 1 vez por
//   execução deste orquestrador (ver "Invariantes" abaixo);
// - chama finalize antes de o Google confirmar existência
//   (`created`/`already_exists`) — `unauthorized`/`error` da Etapa 2
//   retornam imediatamente, SEM chamar finalize, preservando claim e
//   runtime intactos para uma futura tentativa;
// - afirma que o evento "não foi criado" quando o resultado é
//   genuinamente incerto (rede falhou depois do POST chegar ao Google) —
//   ver `execution_uncertain`/`finalization_pending` abaixo.
//
// ============================================================================
// CONTRATO
// ============================================================================
//
// Input: SOMENTE `expectedStateId`/`proposalId` (mesma identidade que
// claim/finalize/cancel já usam) e `action` — a variante
// `create_calendar_event` de `ProposedAction`, já validada estruturalmente
// pela camada que persistiu a `ProposalState` (nunca revalidada aqui;
// `executeCreateCalendarEvent` já faz sua própria validação defensiva de
// `action.event` antes de qualquer chamada ao Google).
//
// Resultado — o menor conjunto possível, cada um com semântica exata:
//
// - `completed`: Google confirmou a existência do evento (criado agora ou
//   já existente) E o finalize local foi concluído (`completed` ou
//   `already_completed`). Sucesso terminal — a runtime já foi consumida
//   pelo finalize.
//
// - `authorization_required`: não foi possível executar por falta de
//   credencial/autorização (401 do Google, ou nem sequer foi possível
//   obter um access token). Claim e runtime PERMANECEM intactos — nenhuma
//   tentativa de reconectar automaticamente, nenhuma segunda chamada.
//
// - `execution_uncertain`: a chamada ao Google terminou num estado
//   tecnicamente incerto (qualquer HTTP não coberto por
//   created/already_exists/401 — incluindo 403 — ou uma exceção de rede,
//   que pode ter acontecido DEPOIS de o POST já ter chegado ao Google).
//   Claim e runtime PERMANECEM intactos, propositalmente: como
//   `googleEventId` é determinístico, um novo "sim" refaz o claim
//   (`already_claimed`, mesmo id) e tenta o MESMO POST — se o evento já
//   tiver sido criado na tentativa anterior, o Google responde 409
//   (`already_exists`), tratado como sucesso idempotente, seguido de
//   finalize normal. Esta é a via de recuperação correta — nunca inventar
//   uma segunda forma de "confirmar" o que aconteceu.
//
// - `finalization_pending`: o Google JÁ confirmou existência
//   (`created`/`already_exists`), mas o finalize local não pôde concluir
//   (`conflict`/`error` da RPC). O evento no Google já existe — este
//   módulo NUNCA tenta desfazê-lo, nunca apaga a runtime manualmente.
//   Uma futura tentativa (novo "sim") refaz claim (`already_claimed`) +
//   Google (409 -> `already_exists`) + finalize novamente — se a causa do
//   `conflict`/`error` anterior foi transitória, a nova tentativa de
//   finalize pode suceder (`already_completed`, dado que a execução já
//   estará com `completed_at` preenchido caso o finalize anterior tenha
//   na verdade commitado apesar do erro reportado ao cliente).
//
// - `conflict`: o CLAIM em si já recusou (state_id obsoleto, runtime
//   ausente/expirada/de outra proposta) — zero chamada ao Google
//   aconteceu.
//
// - `error`: falha técnica do claim (RPC/rede) antes de podermos
//   estabelecer qualquer coisa mais específica — mesma disciplina do
//   resto da pilha, zero chamada ao Google.
//
// ============================================================================
// MAPEAMENTO DETALHADO — Passo 0 (gate) + os 3 passos
// ============================================================================
//
// Passo 0 — GATE (`hasGoogleCalendarEventWriteAuthorization`), chamado
// exatamente 1 vez, ANTES de qualquer claim:
//   authorized    -> segue para o Passo 1 (claim)
//   unauthorized  -> retorna 'authorization_required' IMEDIATAMENTE — zero
//                    claim, zero Google, zero finalize, zero
//                    calendar_event_execution criada. A runtime permanece
//                    uma ProposalState normal — o usuário ainda pode
//                    responder "não" depois, e o cancelamento funciona
//                    normalmente (nunca houve claim para colidir com ele).
//   error         -> retorna 'error' IMEDIATAMENTE — mesma ausência total
//                    de efeito colateral do caso `unauthorized`. Nunca
//                    confundido com `unauthorized`: um erro técnico ao
//                    consultar a capacidade (sessão ausente, admin client
//                    indisponível, falha real de query) não prova que a
//                    conexão carece de escrita — só que não conseguimos
//                    perguntar. Tratar isso como `authorization_required`
//                    mandaria o usuário reconectar sem necessidade.
//
// Passo 1 — CLAIM (`claimCalendarEventExecution`), chamado exatamente 1 vez:
//   claimed          -> segue para Google com este googleEventId
//   already_claimed  -> segue para Google com o MESMO googleEventId
//                       (recuperação segura após timeout/resposta perdida —
//                       NUNCA tratado como erro)
//   conflict         -> retorna 'conflict' imediatamente — zero Google
//   error            -> retorna 'error' imediatamente — zero Google
//
// Passo 2 — GOOGLE (`executeCreateCalendarEvent`), chamado exatamente 1 vez,
// só se o Passo 1 produziu um googleEventId:
//   created          -> segue para finalize
//   already_exists   -> segue para finalize (sucesso idempotente, mesmo id)
//   unauthorized     -> retorna 'authorization_required' — zero finalize,
//                       claim permanece
//   error            -> retorna 'execution_uncertain' — zero finalize,
//                       claim permanece (pode já ter criado o evento)
//
// Passo 3 — FINALIZE (`finalizeCalendarEventExecution`), chamado
// exatamente 1 vez, só se o Passo 2 confirmou existência:
//   completed         -> retorna 'completed'
//   already_completed -> retorna 'completed' (idempotente)
//   conflict          -> retorna 'finalization_pending' (Google já
//                        confirmou; nunca afirmar falha de criação)
//   error             -> retorna 'finalization_pending' (mesma razão)
//
// ============================================================================
// RACE COM CANCELAMENTO (estrutural — nenhuma mudança de arquitetura SQL)
// ============================================================================
//
// "sim" vence a corrida contra um "não" concorrente/posterior: o claim
// (Passo 1) já terá inserido a linha em `calendar_event_executions` antes
// de qualquer `cancel_calendar_event_proposal` conseguir seu próprio lock
// de runtime — um cancelamento que chegue depois encontra a execução já
// reivindicada e retorna `execution_started` (nunca `cancelled`). Ver
// supabase/migrations/20260901120000_add_cancel_calendar_event_proposal.sql
// para a prova formal dos dois interleavings — nenhuma mudança de ordem de
// locks foi feita nesta subfase, este módulo só é mais um CLIENTE dessa
// garantia já existente.
//
// "não" vence a corrida: a runtime é apagada pelo cancel ANTES de este
// orquestrador conseguir seu próprio claim — o claim (Passo 1) retorna
// `conflict` (runtime não encontrada), e este módulo para imediatamente,
// zero chamada ao Google.
//
// Conexão antiga (gate = unauthorized) + "sim": o Passo 0 retorna
// `authorization_required` ANTES de qualquer claim — nenhuma linha é
// inserida em `calendar_event_executions`. A runtime permanece uma
// ProposalState normal, nunca reivindicada. Um "não" seguinte (mesmo
// concorrente) encontra a MESMA situação que sempre existiu antes de
// qualquer claim: `cancel_calendar_event_proposal` não encontra execução
// nenhuma e cancela normalmente (`cancelled`) — o gate desta subfase não
// muda em nada a semântica de cancelamento, porque nunca chega perto de
// criar o único artefato (a linha de execution) que faria cancel se
// comportar diferente.
//
// ============================================================================
// RESPOSTA PERDIDA — o que é e o que não é resolvido aqui
// ============================================================================
//
// Perdida DEPOIS do Google, ANTES do finalize commitar: a runtime
// permanece (claim nunca a apaga; Google/finalize não a tocam se falharem
// antes). Um novo "sim" dentro da MESMA janela de validade da runtime
// refaz claim (`already_claimed`, mesmo googleEventId) -> Google (409,
// porque o evento já existe -> `already_exists`) -> finalize -> sucesso.
// Esta é a recuperação correta e é inteiramente automática, sem heurística
// nova: o próprio determinismo do id já garante isso.
//
// Perdida DEPOIS do finalize COMMITAR: a runtime já foi consumida. Um
// "sim" solto não encontra mais runtime para casar (mesma limitação de UX
// da V1 já aceita e registrada desde a Subfase 4 — a propriedade
// preservada continua sendo "o evento nunca é duplicado", nunca "toda
// resposta é sempre reconstruível"). Esta subfase NÃO tenta resolver isso
// com histórico de conversas/nova tabela/worker/polling — permanece fora
// de escopo, exatamente como já registrado.
// ============================================================================

type CalendarEventProposedAction = Extract<ProposedAction, { actionType: 'create_calendar_event' }>;

export type ConfirmCalendarEventInput = {
  expectedStateId: string;
  proposalId: string;
  action: CalendarEventProposedAction;
};

export type ConfirmCalendarEventResult =
  | { status: 'completed' }
  | { status: 'authorization_required' }
  | { status: 'execution_uncertain' }
  | { status: 'finalization_pending' }
  | { status: 'conflict' }
  | { status: 'error' };

export async function confirmCalendarEvent(
  input: ConfirmCalendarEventInput,
): Promise<ConfirmCalendarEventResult> {
  const { expectedStateId, proposalId, action } = input;

  // --- Passo 0: GATE de autorização de escrita, ANTES de qualquer claim ---
  //
  // Uma conexão antiga (freebusy-only) nunca deveria sequer tentar um
  // claim — ver "PROBLEMA CRÍTICO" no cabeçalho da migration
  // 20260901130000_add_google_calendar_event_write_capability.sql.
  const authorization = await hasGoogleCalendarEventWriteAuthorization();

  if (authorization === 'unauthorized') {
    return { status: 'authorization_required' };
  }
  if (authorization === 'error') {
    // Falha técnica ao consultar a capacidade — nunca confundida com
    // "sabemos que não pode" (ver cabeçalho do arquivo).
    return { status: 'error' };
  }

  // --- Passo 1: CLAIM, exatamente 1 chamada -------------------------------
  const claimResult = await claimCalendarEventExecution({ expectedStateId, proposalId });

  if (claimResult.status === 'conflict') {
    return { status: 'conflict' };
  }
  if (claimResult.status === 'error') {
    return { status: 'error' };
  }

  // claimResult.status é 'claimed' | 'already_claimed' aqui — nos dois
  // casos, googleEventId já está determinado e é o MESMO a partir daqui.
  // `already_claimed` nunca é tratado como erro — é a via de recuperação
  // segura descrita no cabeçalho.
  const { googleEventId } = claimResult;

  // --- Passo 2: GOOGLE, exatamente 1 chamada ------------------------------
  const executionResult = await executeCreateCalendarEvent({ googleEventId, event: action.event });

  if (executionResult.status === 'unauthorized') {
    // Claim permanece; runtime nunca é tocada neste caminho.
    return { status: 'authorization_required' };
  }
  if (executionResult.status === 'error') {
    // Genuinamente incerto — pode já ter criado o evento (falha de rede
    // depois do POST chegar ao Google). Claim permanece; ver cabeçalho
    // para a via de recuperação (googleEventId determinístico).
    return { status: 'execution_uncertain' };
  }

  // executionResult.status é 'created' | 'already_exists' aqui — o Google
  // já confirmou (ou já tinha confirmado antes) a existência do evento.

  // --- Passo 3: FINALIZE, exatamente 1 chamada ----------------------------
  const finalizeResult = await finalizeCalendarEventExecution({ expectedStateId, proposalId });

  if (finalizeResult.status === 'completed' || finalizeResult.status === 'already_completed') {
    return { status: 'completed' };
  }

  // finalizeResult.status é 'conflict' | 'error' aqui — o evento no Google
  // já existe (Passo 2 já confirmou); NUNCA afirmar que a criação falhou,
  // NUNCA tentar desfazer o evento, NUNCA apagar a runtime manualmente.
  return { status: 'finalization_pending' };
}
