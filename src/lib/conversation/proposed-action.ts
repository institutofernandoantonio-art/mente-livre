import type { StructuredIntent } from './types';

// ============================================================================
// Proposed Action — "esta é a operação concreta que o sistema PRETENDE
// propor" a partir de um StructuredIntent já materializável.
//
// NÃO significa: usuário confirmou; usuário autorizou; um WRITE pode
// acontecer; ownership já foi revalidado; execução já foi permitida.
// `status: 'proposed'` aqui tem exatamente o mesmo tipo de garantia (e a
// mesma ausência de garantia) que `status: 'ready'` já tem em
// clarification.ts — informação suficiente para a PRÓXIMA etapa, nunca
// autorização para a etapa final.
//
// Módulo 100% puro: sem I/O, sem Date.now(), sem dependência de Next.js/
// Supabase/Google/Anthropic. Só transforma dados já existentes em mãos —
// nunca busca, nunca persiste, nunca decide confirmação/execução.
//
// `ProposedAction` é DADO, nunca comportamento: nenhum execute()/run()/
// apply()/commit(), nenhuma closure, nenhum client, nenhum token, nenhum
// userId — só campos serializáveis (string/number/null/unions/objetos
// simples), prontos para atravessar uma fronteira Server Action/UI no
// futuro sem qualquer transformação.
//
// `actionType` é deliberadamente diferente de `intentType`:
// StructuredIntent descreve O QUE o usuário quer; ProposedAction descreve
// QUAL operação concreta será proposta. Um mesmo intentType pode um dia
// não gerar action alguma (advisory), e um actionType nunca deveria
// reutilizar o literal do intentType correspondente — daí
// 'create_local_task', não 'create_task'.
// ============================================================================

// --- Union de ações (hoje, uma só variante) ---------------------------------
//
// Escrita como union discriminada mesmo com uma única variante — evita
// que crescer para uma segunda ação (ainda bloqueada por infraestrutura
// ausente: Calendar write, reminders, resolução de participantes — ver
// relatório de mapeamento da subfase correspondente) exija redesenhar o
// tipo desde o zero.
//
// Deliberadamente SEM: user_id, brain_dump_id, category, status,
// needs_confirmation, created_at/updated_at — todos são detalhes de
// PERSISTÊNCIA (linha da tabela `items`), não da operação de domínio.
// `category`/`status` já têm DEFAULT no schema ('tarefa'/'pending') e
// create_task já os implica semanticamente; a futura Execution os aplica,
// não esta camada. Deliberadamente SEM proposalId/createdAt/expiresAt
// (pertencem a um futuro ProposalState, não à ação em si), displayText
// (UI/voz futura deriva dos campos estruturados, nunca duplicado aqui) e
// riskLevel/requiresConfirmation (derivados pela futura Confirmation
// Policy a partir do `actionType`, nunca embutidos no dado).
export type ProposedAction = {
  actionType: 'create_local_task';
  task: {
    // Preservados verbatim de TaskRef — nunca reescritos/normalizados
    // semanticamente, nunca gerados por IA nesta camada.
    title: string;
    description: string | null;
    // `null` = nenhum prazo associado a esta tarefa (nunca inventado).
    // Presente = Deadline já resolvido (`source` sempre 'stated'/
    // 'inferred' aqui — um Deadline 'unresolved' nunca chega a este
    // shape, ver buildProposedAction). `source` preservado para que uma
    // futura Confirmation Policy possa distinguir "usuário disse
    // explicitamente" de "o sistema inferiu" antes de mostrar ao
    // usuário — `confidence` numérica não é preservada nesta primeira
    // versão: nenhum consumidor concreto precisa dela ainda, e
    // carregá-la sem uso definido seria expandir o contrato sem
    // necessidade.
    deadline: { at: string; source: 'stated' | 'inferred' } | null;
    // Mesmo princípio de `deadline`, para Duration.
    duration: { minutes: number; source: 'stated' | 'inferred' } | null;
  };
};

// --- Resultado do builder ------------------------------------------------
//
// `unsupported`: o intent não é do tipo que este builder sabe tratar.
//
// `not_materializable`: o intent É create_task, mas carrega informação
// temporal que este builder não pode representar com segurança agora —
// ver buildProposedAction para os dois casos reais. Distinto de
// `unsupported` porque aqui o tipo de intent é certo, só a etapa de
// materialização (que exigiria Planning, explicitamente fora de escopo)
// que ainda não existe — mesma distinção de status já estabelecida em
// reference-matching.ts/reference-resolution.ts entre "tipo não
// suportado" e "não consegui resolver desta vez".
export type ProposedActionBuildResult =
  | { status: 'proposed'; action: ProposedAction }
  | { status: 'unsupported' }
  | { status: 'not_materializable' };

// --- Builder -------------------------------------------------------------
//
// Não recomputa evaluateClarification nem duplica nenhuma regra de
// clarification.ts — confia estruturalmente em `create_task` (task
// sempre presente, título sempre real, exatamente como o próprio
// contrato de tipos já garante). Em vez disso, aplica só as checagens
// ESTRITAMENTE necessárias para não perder informação ao materializar,
// que são um problema diferente do que a Clarification Policy resolve.
//
// ACHADO DELIBERADAMENTE NÃO ESCONDIDO: `collectMissingFields` para
// `create_task` (clarification.ts) sempre retorna `[]` — a Clarification
// Policy nunca exige que `deadline`/`duration`/`temporalWindow` estejam
// resolvidos para considerar a intenção `ready` (comentário do próprio
// código: "ausência... limita planejamento futuro, mas não impede criar a
// tarefa em si"). Isso significa que um `create_task` `ready` PODE conter
// um `deadline`/`duration` com `source: 'unresolved'` — o usuário
// mencionou um prazo/duração, mas o valor ainda não foi resolvido. Tratar
// isso como se o campo não existisse (`null`) apagaria silenciosamente
// uma informação real que o usuário forneceu ("até sexta", só que ainda
// não sabemos quando é "sexta"). Por isso este builder NUNCA converte
// `unresolved` em `null`: retorna `not_materializable` para o intent
// inteiro nesse caso, preferindo não propor nada a propor uma tarefa sem
// prazo/duração que na verdade foram mencionados. Isso não exige (nem
// deveria exigir) nenhuma mudança em clarification.ts — é uma regra
// adicional e estritamente mais restritiva aplicada só aqui, no momento
// de decidir se HÁ uma proposta concreta a construir.
//
// `temporalWindow`: `items` (schema atual) não tem nenhuma coluna para
// persistir qualquer forma de janela temporal — nem os kinds "ricos"
// (fixed/anchored_start/relative_day/next_free_slot/relative_to_event,
// que descrevem preferência de agendamento, responsabilidade de uma
// futura camada de Planning, não de um insert direto em `items`) nem o
// kind 'unresolved' (que já perderia informação por conta própria, pelo
// mesmo motivo de deadline/duration acima). Como nenhum desses kinds é
// hoje materializável por create_local_task sem inventar dado ou exigir
// Planning (explicitamente fora de escopo desta subfase), qualquer
// `temporalWindow` não-nulo torna o intent inteiro `not_materializable`
// — uma regra única e simples, em vez de tentar representar parcialmente
// alguns kinds e não outros.
export function buildProposedAction(intent: StructuredIntent): ProposedActionBuildResult {
  if (intent.intentType !== 'create_task') {
    return { status: 'unsupported' };
  }

  if (intent.temporalWindow !== null) {
    return { status: 'not_materializable' };
  }

  const { deadline, duration } = intent;

  if (deadline !== null && deadline.source === 'unresolved') {
    return { status: 'not_materializable' };
  }
  if (duration !== null && duration.source === 'unresolved') {
    return { status: 'not_materializable' };
  }

  // A partir daqui, TypeScript já estreitou deadline/duration para
  // `null | { source: 'stated' | 'inferred'; value; confidence }` — as
  // checagens acima excluíram estruturalmente o ramo 'unresolved'.
  const proposedDeadline =
    deadline === null ? null : { at: deadline.value.at, source: deadline.source };
  const proposedDuration =
    duration === null ? null : { minutes: duration.value.minutes, source: duration.source };

  return {
    status: 'proposed',
    action: {
      actionType: 'create_local_task',
      task: {
        title: intent.task.title,
        description: intent.task.description,
        deadline: proposedDeadline,
        duration: proposedDuration,
      },
    },
  };
}
