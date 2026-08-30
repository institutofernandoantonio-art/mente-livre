import 'server-only';

import { createClient } from '../supabase/server';
import type { ProposedAction } from './proposed-action';

// ============================================================================
// Local task execution — o wrapper fino que encapsula a chamada à RPC
// atômica `public.confirm_create_local_task`
// (supabase/migrations/20260826140000_create_confirm_create_local_task_function.sql).
//
// Módulo IRMÃO de proposal-turn.ts/confirmation.ts, não uma extensão de
// nenhum deles. Usado por proposal-turn.ts para executar, via a RPC
// atômica, uma proposta `create_local_task` já confirmada pela
// Confirmation Policy — nunca chamado diretamente por nenhuma outra
// camada.
//
// Este módulo NUNCA:
// - decide se uma proposta foi confirmada/cancelada (isso é
//   confirmation.ts) — só executa, depois que essa decisão já foi tomada
//   em outro lugar;
// - lê/interpreta ConversationState/ProposalState/StoredRuntimeState —
//   recebe só os campos já extraídos e validados por quem chama
//   (nunca `raw ProposalState`, nunca payload JSON bruto);
// - aceita `userId`, e-mail, claims, ou um client Supabase de fora — a
//   RPC deriva a identidade via `auth.uid()` na própria sessão do
//   usuário atual, propagada automaticamente pelo client server-side
//   normal (mesmo `createClient()` de `../supabase/server` já usado por
//   runtime-state-storage.ts) — nunca `createAdminClient()`/service role;
// - insere diretamente em `items` ou em `conversation_runtime_states` —
//   a ÚNICA operação de I/O aqui é `supabase.rpc('confirm_create_local_task', ...)`;
// - faz uma segunda consulta para "explicar" um `conflict` — mesma
//   disciplina anti-TOCTOU já aplicada em toda a pilha (ver
//   runtime-state-storage.ts/proposal-turn.ts): `conflict` é terminal,
//   nunca dispara retry/fallback/reinterpretação;
// - reclassifica um erro técnico (incluindo uma hipotética violação de
//   `items_proposal_id_unique`) como `created` — a migration já decidiu
//   que isso é uma inconsistência extraordinária, não um caminho feliz;
// - vaza `message`/`details`/`hint`/`code`/stack do erro do Supabase —
//   só o status técnico `error` cruza esta fronteira;
// - usa `console.*` — mesma disciplina de privacidade de
//   runtime-state-storage.ts;
// - menciona/opera Google Calendar.
//
// --- Testabilidade -----------------------------------------------------
//
// Nenhum parâmetro `deps?`, nenhum client injetável, nenhum seam de teste
// na API pública — mesmo precedente já estabelecido e revisado em
// conversation-turn.ts/proposal-turn.ts. `createClient()` é importado de
// forma normal e estática; o hook de resolução usado só pelos testes
// (tests/support/ts-extension-loader.mjs) redireciona esse specifier
// para um dublê (tests/support/fake-supabase-server.mjs), sem que este
// arquivo saiba disso.
// ============================================================================

// --- Validação mínima de boundary (mesmo padrão de runtime-state-storage.ts) -

// `now` chega tipado como `number`, mas ainda é tratado como boundary não
// confiável em runtime — mesma defesa em profundidade já aplicada a
// `isValidNow` em runtime-state-storage.ts (não importado daqui: é uma
// função privada, não exportada, daquele módulo — reescrever localmente
// uma checagem genérica de 3 linhas não duplica nenhuma regra de domínio).
function isValidNow(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

// Único ponto de conversão de tempo deste módulo — mesmo racional e mesma
// implementação de `toIsoTimestamp` em runtime-state-storage.ts (privada
// lá, reescrita aqui pelo mesmo motivo do helper acima). `new
// Date(ms).toISOString()` pode lançar `RangeError` para um `ms` fora do
// intervalo representável — nunca deixado escapar como exceção não
// controlada.
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

// --- Validação defensiva do retorno da RPC ------------------------------
//
// `supabase.rpc(...)` para uma função `RETURNS TABLE` devolve um ARRAY de
// linhas em `data`. Nada aqui confia nesse shape sem checar: mesma
// disciplina de "aceitar ou rejeitar, nunca corrigir/coagir" já usada em
// runtime-state-validation.ts (hasExactKeys, sem campo a mais nem a
// menos). Qualquer desvio de shape — não é array, não tem exatamente 1
// linha, chaves erradas, `status` desconhecido, `item_id` incoerente com
// `status` — colapsa em `error`, nunca é "corrigido" para `created`.

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(obj: Record<string, unknown>, keys: readonly string[]): boolean {
  const objKeys = Object.keys(obj);
  if (objKeys.length !== keys.length) {
    return false;
  }
  return keys.every((key) => Object.prototype.hasOwnProperty.call(obj, key));
}

// Validação de shape só — nunca de posse/existência real no banco (isso
// já foi garantido pela própria RPC ao devolver `created`). Usado só para
// o `item_id` devolvido pela RPC, nunca para `expectedStateId`/
// `proposalId` de entrada (que seguem a mesma checagem mínima de
// `runtime-state-storage.ts`, sem exigir formato UUID).
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuidString(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function parseConfirmResult(data: unknown): LocalTaskExecutionResult {
  if (!Array.isArray(data)) {
    return { status: 'error' };
  }
  if (data.length !== 1) {
    return { status: 'error' };
  }

  const row = data[0];
  if (!isPlainObject(row)) {
    return { status: 'error' };
  }
  if (!hasExactKeys(row, ['status', 'item_id'])) {
    return { status: 'error' };
  }

  if (row.status === 'created') {
    if (!isUuidString(row.item_id)) {
      return { status: 'error' };
    }
    return { status: 'created', itemId: row.item_id };
  }

  if (row.status === 'conflict') {
    if (row.item_id !== null) {
      return { status: 'error' };
    }
    return { status: 'conflict' };
  }

  // `status` não é nem 'created' nem 'conflict' — a migration nunca
  // deveria devolver isso; tratado como inconsistência extraordinária,
  // nunca assumido como um dos dois casos conhecidos.
  return { status: 'error' };
}

// --- API pública -----------------------------------------------------------

export type LocalTaskExecutionResult =
  | { status: 'created'; itemId: string }
  | { status: 'conflict' }
  | { status: 'error' };

// `task` usa `Extract<ProposedAction, { actionType: 'create_local_task' }>`
// em vez de `ProposedAction['task']` direto: hoje as duas expressões
// resolvem para o mesmo tipo (ProposedAction só tem essa variante), mas
// proposed-action.ts já documenta a intenção de crescer para uma union
// discriminada de verdade quando uma segunda ação existir. Com `Extract`,
// essa evolução futura continua compilando e continua correta (seleciona
// só a variante certa); com o indexamento direto, o mesmo futuro já
// quebraria em tempo de compilação — o que é seguro, mas força um
// ajuste que `Extract` evita.
//
// Objeto nomeado (não posicional): único desvio deliberado do estilo
// posicional usado no resto de src/lib/conversation/ (advanceRuntimeState,
// consumeRuntimeState, resolveProposalConversationalTurn, ...). Nenhum
// desses tem dois parâmetros string adjacentes e semanticamente distintos;
// aqui `expectedStateId` e `proposalId` são ambos strings opacas (na
// prática, ambos UUIDs) — uma troca posicional entre os dois compilaria
// sem erro e produziria um `conflict`/comportamento incorreto silencioso
// em vez de uma falha visível. Um objeto nomeado elimina essa classe de
// erro por construção, sem precisar de nenhuma validação de runtime a
// mais para detectá-la.
export type ExecuteCreateLocalTaskInput = {
  expectedStateId: string;
  proposalId: string;
  task: Extract<ProposedAction, { actionType: 'create_local_task' }>['task'];
  now: number;
};

// Os campos internos de `task` (title/description/deadline/duration) NÃO
// são revalidados aqui — decisão consciente, não uma omissão. Este módulo
// nunca recebe JSON bruto: `task` chega já tipado pelo TypeScript e, no
// futuro fluxo real de integração (ainda não conectado nesta subfase),
// viria de um `ProposalState.action.task` que já passou por
// `validateStoredRuntimeState`/`isValidProposedAction`
// (runtime-state-validation.ts) ao ser lido de volta do storage.
// Revalidar o mesmo shape aqui duplicaria uma regra de domínio que já tem
// dono. O que ESTE módulo garante — porque é o único lugar onde faria
// sentido garantir — é a fronteira própria dele: identificadores não
// vazios e um `now` numericamente válido, checados abaixo antes de
// qualquer I/O. Qualquer violação de regra de negócio mais profunda (ex.:
// `title` em branco) que escapasse de todas as camadas anteriores ainda
// seria barrada pelas constraints reais de `public.items`, e chegaria
// aqui como `error` técnico (via `error` do supabase.rpc), nunca como um
// `created` incorreto.
export async function executeCreateLocalTask(
  input: ExecuteCreateLocalTaskInput,
): Promise<LocalTaskExecutionResult> {
  const { expectedStateId, proposalId, task, now } = input;

  if (!isNonEmptyString(expectedStateId)) {
    return { status: 'error' };
  }
  if (!isNonEmptyString(proposalId)) {
    return { status: 'error' };
  }

  const nowIso = toIsoTimestamp(now);
  if (nowIso === null) {
    return { status: 'error' };
  }

  // `null` explícito (nunca `undefined`) quando ausente — optional
  // chaining (`task.deadline?.at`) produziria `undefined` em vez de
  // `null` para o caso ausente, o que não é o mesmo valor para um
  // parâmetro `timestamptz` nullable da RPC. Mesmo racional já aplicado
  // em proposed-action.ts para deadline/duration.
  const deadlineAt = task.deadline === null ? null : task.deadline.at;
  const durationMinutes = task.duration === null ? null : task.duration.minutes;

  // Se `createClient()` lançar (ex.: `cookies()` chamado fora de um
  // contexto de request válido do Next.js) ou se `supabase.rpc(...)`
  // rejeitar por um motivo que não o contrato normal `{data, error}`, a
  // exceção propaga sem ser capturada aqui — mesma convenção já
  // estabelecida em runtime-state-storage.ts (getAuthenticatedContext()
  // também nunca envolve `createClient()` em try/catch). Decisão
  // deliberada de consistência, não uma omissão: este módulo não inventa
  // uma semântica de erro diferente da já usada pelo resto de
  // src/lib/conversation/.
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('confirm_create_local_task', {
    p_expected_state_id: expectedStateId,
    p_now: nowIso,
    p_proposal_id: proposalId,
    p_title: task.title,
    p_description: task.description,
    p_deadline_at: deadlineAt,
    p_duration_minutes: durationMinutes,
  });

  if (error) {
    // Nenhum detalhe do erro do Supabase (message/details/hint/code)
    // cruza esta fronteira — só o status técnico.
    return { status: 'error' };
  }

  return parseConfirmResult(data);
}
