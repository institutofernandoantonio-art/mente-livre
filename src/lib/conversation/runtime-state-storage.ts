import 'server-only';

import { createClient } from '../supabase/server';
import { validateStoredRuntimeState, type StoredRuntimeState } from './runtime-state-validation';
import type { ConversationState } from './state';
import type { ProposalState } from './proposal-state';

// ============================================================================
// Runtime state storage — os quatro primitivos server-side que persistem
// ConversationState/ProposalState em `public.conversation_runtime_states`.
//
// Este módulo SÓ persiste. Não interpreta resposta do usuário, não decide
// confirmação, não constrói StructuredIntent/ConversationState/ProposalState
// (createConversationState/createProposalState continuam responsabilidade de
// quem chama), e nunca executa a ação de um ProposedAction (nenhum insert em
// `items`, nenhuma chamada de Calendar). Orchestration ainda não está
// integrada a este módulo — essa conexão é uma subfase futura e separada.
//
// --- REPLACE vs CAS: a distinção central deste módulo -----------------------
//
// `replaceRuntimeState` é a ÚNICA operação não-CAS: uma nova intenção
// substantiva do usuário deliberadamente invalida qualquer runtime state
// atual, sem precisar saber qual era o state anterior (last-write-wins,
// política de produto já aprovada). Não recebe `expectedStateId`.
//
// `advanceRuntimeState`/`consumeRuntimeState` são SEMPRE CAS: representam a
// continuação de um state que o chamador já observou (uma resposta de
// clarificação, um "sim"/"não" a uma proposta) — só têm efeito se
// `expectedStateId` ainda corresponder ao state_id atual da linha do
// usuário. Nenhuma das duas aceita um `expectedStateId` opcional; ambas
// tratam sua ausência como impossível de compilar, não como algo a validar
// em runtime.
//
// Não existe nenhuma operação de DELETE incondicional neste módulo — nem
// para cancelamento ("deixa pra lá" deve sempre chamar consumeRuntimeState
// com o id que o próprio chamador observou). Um cancelamento incondicional
// apagaria uma state nova criada por outro device entre a leitura e o
// cancelamento — exatamente o cenário que todo o mecanismo de CAS existe
// para evitar.
//
// --- Identidade de storage (`state_id`) pertence a este módulo -------------
//
// `RuntimeStateToStore` (o input de `replace`/`advance`) nunca carrega
// `stateId` — é gerado aqui, sempre um novo `crypto.randomUUID()`, nunca
// aceito do chamador. Isso torna a rotação de identidade (toda escrita bem-
// sucedida recebe um id novo) uma garantia estrutural, não uma checagem
// defensiva: não há como um chamador reutilizar acidentalmente um id
// obsoleto, porque nunca é solicitado a fornecer nenhum id para escrever.
// `ProposalState.proposalId` é uma identidade DIFERENTE (de domínio, usada
// pela futura Confirmation Policy) — este módulo nunca gera nem lê esse
// campo, só o persiste como parte do payload.
//
// --- Validação simétrica --------------------------------------------------
//
// Toda row lida (SELECT, ou devolvida por UPDATE/DELETE com `.select()`)
// passa por `validateStoredRuntimeState` antes de virar `StoredRuntimeState`
// — nunca um cast. Toda row a escrever também passa pelo MESMO validador
// antes de qualquer I/O: "nada é escrito que o próprio validador não
// aceitaria ao ler de volta". Se a validação de escrita falhar, `error` é
// retornado com zero I/O.
//
// --- Expiração ------------------------------------------------------------
//
// `now` é sempre recebido explicitamente do chamador, nunca `Date.now()`
// interno — mesma disciplina de determinismo/testabilidade já usada em todo
// `src/lib/conversation/`, mesmo este módulo sendo impuro por natureza
// (I/O). O filtro `expires_at > now` (nunca `>=`) é o espelho exato do
// boundary de domínio `now >= expiresAt ⇒ expirado` já usado em
// `isConversationStateExpired`/`isProposalStateExpired`. As mutações CAS
// (`advance`/`consume`) incorporam esse filtro na MESMA cláusula WHERE do
// `state_id` esperado — zero linhas afetadas por id errado, state ausente,
// já consumido ou expirado colapsam uniformemente em `conflict`, nunca um
// `expired` separado nessas operações (só `getRuntimeState`, por ser
// somente leitura, distingue os dois). Nenhuma query usa `now()` do
// Postgres — sempre o `now` do chamador, para manter a mesma noção de tempo
// da pipeline de domínio.
//
// `replaceRuntimeState`/`advanceRuntimeState` também recusam persistir um
// `next` que já nasce expirado (`now >= next.state.expiresAt`) — decisão
// desta implementação, não dos construtores puros de domínio (que
// deliberadamente não validam isso, ver proposal-state.ts/state.ts):
// gravar algo já inválido no mesmo request não teria nenhuma utilidade e
// só confundiria uma leitura imediatamente seguinte.
//
// --- Auth --------------------------------------------------------------
//
// `createClient()` → `auth.getClaims()` → `claims.sub`, mesmo padrão de
// `reference-resolution.ts`. Nenhuma API pública aceita `userId` — sempre
// derivado da sessão atual. Sessão ausente é falha técnica (`error`), nunca
// `not_found`/`conflict`. Nenhum `service_role`/admin client: RLS own-row
// (SELECT/INSERT/UPDATE/DELETE) já é suficiente, e o filtro explícito
// `.eq('user_id', userId)` é reforço em profundidade, não a única barreira.
//
// --- Privacidade -----------------------------------------------------------
//
// Nenhum `console.*`. Nenhum result de erro carrega detalhe de erro do
// Supabase, `userId`, ou payload inválido/cru — só o status. `found`/
// `saved`/`advanced`/`consumed` carregam `value` só porque esse valor JÁ
// passou por validação completa.
// ============================================================================

const TABLE = 'conversation_runtime_states';

// Select mínimo e centralizado — nunca `*`, nunca `user_id`/`updated_at`.
// Exatamente os 4 campos que `validateStoredRuntimeState` exige na raiz.
const SELECT_FIELDS = 'state_id,state_kind,payload,expires_at';

// --- Tipos públicos ---------------------------------------------------

// Input de escrita — deliberadamente SEM `stateId` (ver cabeçalho).
export type RuntimeStateToStore =
  | { kind: 'clarification'; state: ConversationState }
  | { kind: 'proposal'; state: ProposalState };

export type RuntimeStateReadResult =
  | { status: 'found'; value: StoredRuntimeState }
  | { status: 'not_found' }
  | { status: 'expired' }
  | { status: 'error' };

export type RuntimeStateReplaceResult =
  | { status: 'saved'; value: StoredRuntimeState }
  | { status: 'error' };

export type RuntimeStateAdvanceResult =
  | { status: 'advanced'; value: StoredRuntimeState }
  | { status: 'conflict' }
  | { status: 'error' };

export type RuntimeStateConsumeResult =
  | { status: 'consumed'; value: StoredRuntimeState }
  | { status: 'conflict' }
  | { status: 'error' };

// --- Helpers privados (nenhum exportado) -----------------------------

// Auth por sessão — nunca aceita userId de fora. `null` sinaliza "sem sub
// válido", tratado por todo chamador como `error`, nunca `not_found`.
async function getAuthenticatedContext(): Promise<{
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
} | null> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims.sub;

  if (!userId) {
    return null;
  }

  return { supabase, userId };
}

// `now` é sempre um argumento explícito de quem chama — nunca gerado aqui.
// Epoch ms é por definição inteiro, mesmo tratamento já usado em
// runtime-state-validation.ts para createdAt/expiresAt.
function isValidNow(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);
}

// `expectedStateId` é tipado como `string` pela assinatura, mas ainda é
// tratado como boundary não confiável em runtime (defesa em profundidade,
// mesmo padrão já aplicado a `state_id`/`proposalId` no validador) — nunca
// trim/coerce, só aceita ou rejeita.
function isValidExpectedStateId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

// Única conversão de tempo deste módulo: um epoch ms JÁ recebido como
// argumento, nunca o relógio do sistema. `new Date(ms).toISOString()` pode
// lançar RangeError para um ms fora do intervalo representável — nunca
// deixado escapar como exceção não controlada.
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

type RawRuntimeStateRow = {
  state_id: string;
  state_kind: RuntimeStateToStore['kind'];
  payload: ConversationState | ProposalState;
  expires_at: string;
};

// Constrói a linha mínima que `validateStoredRuntimeState` também aceitaria
// de volta na leitura — nunca inclui `user_id` (isso é adicionado só no
// momento da escrita real, fora deste helper, ver replaceRuntimeState/
// advanceRuntimeState).
function serializeRuntimeState(stateId: string, input: RuntimeStateToStore): RawRuntimeStateRow | null {
  const expiresAt = toIsoTimestamp(input.state.expiresAt);
  if (expiresAt === null) {
    return null;
  }

  return {
    state_id: stateId,
    state_kind: input.kind,
    payload: input.state,
    expires_at: expiresAt,
  };
}

// --- API pública -----------------------------------------------------------

// Fluxo: validar now → auth → query → distinguir error/zero row → validator
// → checar expiração → found. Read-only: nunca apaga uma row expirada (a
// próxima replace/advance bem-sucedida já a sobrescreve naturalmente).
export async function getRuntimeState(now: number): Promise<RuntimeStateReadResult> {
  if (!isValidNow(now)) {
    return { status: 'error' };
  }

  const context = await getAuthenticatedContext();
  if (context === null) {
    return { status: 'error' };
  }
  const { supabase, userId } = context;

  const { data, error } = await supabase
    .from(TABLE)
    .select(SELECT_FIELDS)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    return { status: 'error' };
  }
  if (data === null) {
    return { status: 'not_found' };
  }

  const validated = validateStoredRuntimeState(data);
  if (validated.status === 'invalid') {
    return { status: 'error' };
  }

  if (now >= validated.value.state.expiresAt) {
    return { status: 'expired' };
  }

  return { status: 'found', value: validated.value };
}

// Única operação não-CAS — sem `expectedStateId`. Nova intenção substantiva
// sempre substitui qualquer runtime state atual do mesmo usuário (política
// de produto já aprovada, last-write-wins). Nenhuma leitura prévia.
export async function replaceRuntimeState(
  next: RuntimeStateToStore,
  now: number,
): Promise<RuntimeStateReplaceResult> {
  if (!isValidNow(now)) {
    return { status: 'error' };
  }
  if (now >= next.state.expiresAt) {
    return { status: 'error' };
  }

  const stateId = crypto.randomUUID();
  const row = serializeRuntimeState(stateId, next);
  if (row === null) {
    return { status: 'error' };
  }

  const validated = validateStoredRuntimeState(row);
  if (validated.status === 'invalid') {
    return { status: 'error' };
  }

  const context = await getAuthenticatedContext();
  if (context === null) {
    return { status: 'error' };
  }
  const { supabase, userId } = context;

  const { data, error } = await supabase
    .from(TABLE)
    .upsert({ user_id: userId, ...row }, { onConflict: 'user_id' })
    .select('state_id')
    .maybeSingle();

  if (error || data === null) {
    return { status: 'error' };
  }

  return { status: 'saved', value: validated.value };
}

// CAS: só aplica `next` se a linha atual do usuário ainda tiver
// `state_id === expectedStateId` e ainda não estiver expirada — ambas as
// condições na MESMA cláusula WHERE do UPDATE, atomicamente. Cobre tanto
// avançar dentro do mesmo kind quanto a transição clarification→proposal
// (ou o inverso): `state_kind` é só mais uma coluna trocada no mesmo UPDATE,
// nunca delete+insert.
export async function advanceRuntimeState(
  expectedStateId: string,
  next: RuntimeStateToStore,
  now: number,
): Promise<RuntimeStateAdvanceResult> {
  if (!isValidExpectedStateId(expectedStateId)) {
    return { status: 'error' };
  }
  if (!isValidNow(now)) {
    return { status: 'error' };
  }
  if (now >= next.state.expiresAt) {
    return { status: 'error' };
  }

  const stateId = crypto.randomUUID();
  const row = serializeRuntimeState(stateId, next);
  if (row === null) {
    return { status: 'error' };
  }

  const validated = validateStoredRuntimeState(row);
  if (validated.status === 'invalid') {
    return { status: 'error' };
  }

  const context = await getAuthenticatedContext();
  if (context === null) {
    return { status: 'error' };
  }
  const { supabase, userId } = context;

  const nowIso = toIsoTimestamp(now);
  if (nowIso === null) {
    return { status: 'error' };
  }

  const { data, error } = await supabase
    .from(TABLE)
    .update(row)
    .eq('user_id', userId)
    .eq('state_id', expectedStateId)
    .gt('expires_at', nowIso)
    .select('state_id')
    .maybeSingle();

  if (error) {
    return { status: 'error' };
  }
  // Zero linhas casadas — id obsoleto, state ausente, já consumida,
  // expirada, ou substituída por outro device: todos os casos colapsam em
  // `conflict`. Uma segunda query para classificar qual desses ocorreu
  // reabriria exatamente a janela de corrida que o filtro atômico evita.
  if (data === null) {
    return { status: 'conflict' };
  }

  return { status: 'advanced', value: validated.value };
}

// CAS: remove a linha atual do usuário só se `state_id === expectedStateId`
// e ainda não expirada — mesmo filtro atômico de advanceRuntimeState, agora
// em DELETE. Serve indistintamente para confirmação (chamador usa `value`),
// rejeição/cancelamento (chamador descarta `value`) e proteção contra
// replay (uma segunda tentativa idêntica não encontra mais a linha).
// Nenhuma variante "clear" separada existe — seria a mesma operação de
// banco com o retorno ignorado.
export async function consumeRuntimeState(
  expectedStateId: string,
  now: number,
): Promise<RuntimeStateConsumeResult> {
  if (!isValidExpectedStateId(expectedStateId)) {
    return { status: 'error' };
  }
  if (!isValidNow(now)) {
    return { status: 'error' };
  }

  const context = await getAuthenticatedContext();
  if (context === null) {
    return { status: 'error' };
  }
  const { supabase, userId } = context;

  const nowIso = toIsoTimestamp(now);
  if (nowIso === null) {
    return { status: 'error' };
  }

  const { data, error } = await supabase
    .from(TABLE)
    .delete()
    .eq('user_id', userId)
    .eq('state_id', expectedStateId)
    .gt('expires_at', nowIso)
    .select(SELECT_FIELDS)
    .maybeSingle();

  if (error) {
    return { status: 'error' };
  }
  if (data === null) {
    return { status: 'conflict' };
  }

  // A linha JÁ foi removida neste ponto — mesmo que o payload devolvido
  // falhe a validação, não há como "reter" o dado original com segurança:
  // devolvê-lo sem validar seria confiar em algo potencialmente corrompido,
  // então o único resultado seguro é `error`, nunca um `value` não validado.
  const validated = validateStoredRuntimeState(data);
  if (validated.status === 'invalid') {
    return { status: 'error' };
  }

  return { status: 'consumed', value: validated.value };
}
