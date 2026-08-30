// ============================================================================
// Presentation helpers da listagem de tarefas — puro (zero I/O, zero
// dependência de React/Next/Supabase), mesmo racional de
// `src/lib/conversation/presentation-ui.ts`: mapeamento estritamente visual,
// nunca lógica de domínio, sempre testável com `node:assert` sem precisar
// renderizar nenhum componente.
//
// Este módulo NUNCA:
// - decide o que é uma tarefa válida — só traduz um `status`/`deadline_at`
//   já lido do banco para texto humano;
// - altera o valor original — formatação estritamente de apresentação.
// ============================================================================

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendente',
  completed: 'Concluída',
  cancelled: 'Cancelada',
};

// Fallback para o valor bruto (nunca "Desconhecido"/erro) — mesma
// disciplina de `formatDeadlinePreview` (conversation/presentation-ui.ts):
// nunca esconder o dado só porque não há um rótulo bonito para ele.
// `items_status_allowed` já restringe `status` a exatamente estes 3
// valores no banco, então este fallback é defensivo, não um caminho real.
export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

// Mesma implementação/racional de `formatDeadlinePreview`
// (conversation/presentation-ui.ts) — duplicação pequena e aceitável de um
// utilitário genérico de apresentação, não de regra de domínio (mesma
// decisão já tomada em local-task-execution.ts/intent-extraction.ts para
// `toIsoTimestamp`).
export function formatDeadline(deadlineAt: string | null): string | null {
  if (deadlineAt === null) {
    return null;
  }
  const parsed = new Date(deadlineAt);
  if (Number.isNaN(parsed.getTime())) {
    // Fallback seguro: nunca esconde o dado por não conseguir formatá-lo.
    return deadlineAt;
  }
  return parsed.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}
