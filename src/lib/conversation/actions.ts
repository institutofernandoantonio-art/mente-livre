'use server';

import { handleConversationMessage, type ConversationEntryResult } from './conversation-entry';

// ============================================================================
// Server Action pública — a menor transport boundary entre uma futura UI e o
// dispatcher `handleConversationMessage` (conversation-entry.ts).
//
// Este arquivo NUNCA:
// - importa runtime-state-storage/intent-extraction/conversation-turn/
//   proposal-turn/conversation-ttl/confirmation/local-task-execution
//   diretamente — conhece SÓ `conversation-entry.ts`, a única abstração já
//   aprovada para esta fronteira. Nenhuma lógica de domínio é reimplementada
//   ou duplicada aqui;
// - importa Supabase/Google Calendar/Anthropic — nenhuma dessas dependências
//   pertence a esta camada;
// - autentica (`createClient`/`getClaims`/`getUser`) — o dispatcher já
//   protege isso via a leitura inicial de runtime storage
//   (`getRuntimeState`), comprovado na subfase de mapeamento
//   correspondente: sem sessão, essa leitura já retorna `error` ANTES de
//   qualquer chamada de NLU. Duplicar auth aqui não adicionaria proteção
//   nenhuma, só uma segunda checagem a manter sincronizada;
// - valida ou transforma `text` — o dispatcher já faz isso
//   (`isNonBlankString`). Repassado exatamente como recebido, sem
//   trim/normalização/coerção;
// - aceita `now`/`userId`/`stateId`/`proposalId`/`expiresAt`/
//   `StructuredIntent`/`ProposedAction`/`ConversationState`/`ProposalState`/
//   client Supabase do chamador — os únicos parâmetros públicos são
//   `text`/`timezone`.
//
// --- `now`: gerado aqui, e só aqui, nesta camada -------------------------
//
// `Date.now()` é chamado uma única vez, sempre server-side (esta função só
// executa no servidor, por ser uma Server Action — `'use server'` acima).
// O browser nunca fornece `now`: não existe parâmetro para isso, nem aqui
// nem em nenhuma camada abaixo desta.
//
// --- `timezone`: contexto do cliente, repassado sem validar aqui ---------
//
// Adicionado nesta subfase (query_calendar read-only) — o browser envia
// `Intl.DateTimeFormat().resolvedOptions().timeZone` (capturado em
// `ConversationPanel.tsx`) junto de cada mensagem. Timezone é contexto do
// cliente, nunca dado de autorização/identidade — esta camada não valida
// nem interpreta o valor, só o repassa cru para `handleConversationMessage`
// (que também só repassa — a validação real, e o que fazer com timezone
// inválido, vivem exclusivamente em `calendar-query.ts`, a única camada que
// precisa resolver `relative_day`).
//
// --- Catch estreito --------------------------------------------------------
//
// Envolve SOMENTE a chamada a `handleConversationMessage` — qualquer
// exceção inesperada (o dispatcher já mapeia toda falha conhecida para
// `{status:'error'}`; só uma exceção genuinamente não prevista, propagada
// de alguma camada inferior — ver conversation-entry.ts/
// local-task-execution.ts — chegaria até aqui) vira `{status:'error'}`.
// Nunca loga texto do usuário, stack, erro de Supabase/provider, ou
// qualquer detalhe cru — só o status técnico cruza esta fronteira. Sem
// retry: uma segunda tentativa automática não é decisão desta camada.
// ============================================================================

export async function sendConversationMessage(text: string, timezone: string): Promise<ConversationEntryResult> {
  const now = Date.now();

  try {
    return await handleConversationMessage(text, now, timezone);
  } catch {
    return { status: 'error' };
  }
}
