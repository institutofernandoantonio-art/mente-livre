// ============================================================================
// Conversation TTL — política centralizada de expiração para os dois tipos
// de runtime state (clarificação e proposta).
//
// Único lugar do projeto onde a DURAÇÃO de cada tipo de state é decidida.
// Todo o resto da pilha (state.ts, proposal-state.ts, conversation-turn.ts,
// orchestration.ts, runtime-state-storage.ts) já recebe `expiresAt`/
// `nextExpiresAt` como timestamp ABSOLUTO externo — nenhum desses módulos
// precisa mudar para que a futura camada de entry/dispatcher use este
// módulo: ela simplesmente passa a chamar `getClarificationExpiresAt(now)`/
// `getProposalExpiresAt(now)` no lugar de calcular a soma ela mesma.
//
// POLÍTICA V1 (aprovada):
// - clarificação: 24 horas;
// - proposta aguardando confirmação: 30 minutos.
//
// Módulo 100% puro: zero I/O, zero `server-only`, zero Supabase/fetch/
// Anthropic/process.env, zero `Date.now()`/`new Date(...)` interno — `now`
// é sempre um argumento explícito de quem chama, mesmo princípio já usado
// em toda `src/lib/conversation/`. Nenhuma conversão de timezone: todo
// cálculo é aritmética inteira sobre epoch milliseconds, nunca um objeto
// `Date`.
//
// NÃO implementa TTL deslizante/refresh automático — decide só a duração
// de UM novo state a partir de UM `now`; quando gerar um novo `expiresAt`
// (nova pergunta, nova proposta) é decisão da futura camada de entry, não
// deste módulo.
//
// --- Validação de `now` --------------------------------------------------
//
// Diferente de state.ts/proposal-state.ts (que deliberadamente NÃO
// validam `now`/`expiresAt` em seus construtores, confiando
// estruturalmente na fronteira chamadora — ver comentário de
// createProposalState) — aqui a validação é a única responsabilidade real
// do módulo (um helper aritmético de um único input), então um `now`
// inválido lançar alto e claro (`TypeError`) é mais seguro do que deixar
// `NaN`/`Infinity` se propagar silenciosamente até um futuro `expiresAt`
// persistido. O resultado da soma também é validado pelo mesmo motivo
// (guarda contra overflow numérico, ex.: `now` próximo de
// `Number.MAX_SAFE_INTEGER`).
// ============================================================================

export const CLARIFICATION_TTL_MS = 24 * 60 * 60 * 1000; // 24 horas
export const PROPOSAL_TTL_MS = 30 * 60 * 1000; // 30 minutos

// `Number.isSafeInteger` (não só `Number.isFinite` + `Number.isInteger`):
// além de finito e inteiro, garante que o valor ainda é exatamente
// representável em ponto flutuante — um `now` patologicamente grande
// somado ao TTL pode resultar num número que `Number.isInteger` aceitaria
// mesmo já tendo perdido precisão além de `Number.MAX_SAFE_INTEGER`.
function isValidEpochMillis(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function computeExpiresAt(now: number, ttlMs: number): number {
  if (!isValidEpochMillis(now)) {
    throw new TypeError(`now inválido: esperado epoch ms inteiro e finito, recebido ${String(now)}`);
  }

  const expiresAt = now + ttlMs;

  if (!isValidEpochMillis(expiresAt)) {
    // Estruturalmente só alcançável com um `now` patologicamente próximo
    // do limite representável — nunca silenciado como se fosse um
    // `expiresAt` válido.
    throw new TypeError(`expiresAt calculado é inválido (overflow?): ${String(expiresAt)}`);
  }

  return expiresAt;
}

export function getClarificationExpiresAt(now: number): number {
  return computeExpiresAt(now, CLARIFICATION_TTL_MS);
}

export function getProposalExpiresAt(now: number): number {
  return computeExpiresAt(now, PROPOSAL_TTL_MS);
}
