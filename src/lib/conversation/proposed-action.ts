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

// --- Union de ações (hoje, duas variantes) ----------------------------------
//
// Escrita como union discriminada desde a primeira versão — a segunda
// variante (`create_calendar_event`) chegou exatamente como o comentário
// original antecipava, sem redesenhar o tipo: só um novo membro da union.
//
// `create_calendar_event`: materializada por `buildCreateCalendarEventAction`
// (`./calendar-event-proposal.ts`), NUNCA por `buildProposedAction` abaixo
// — os dois builders são deliberadamente separados porque têm assinaturas
// diferentes (`create_local_task` não precisa de `now`/`timezone`;
// `create_event` precisa dos dois para resolver um instante absoluto — ver
// relatório de mapeamento e o cabeçalho de `calendar-event-proposal.ts`).
// Nesta subfase, `create_calendar_event` é só o RESULTADO de tipo — nenhum
// código real ainda persiste um `ProposalState`/`ProposedAction` com esta
// variante (`conversation-turn.ts`/`proposal-turn.ts` intocados).
//
// Deliberadamente SEM: user_id, brain_dump_id, category, status,
// needs_confirmation, created_at/updated_at — todos são detalhes de
// PERSISTÊNCIA (linha de uma tabela), não da operação de domínio.
// `category`/`status` já têm DEFAULT no schema ('tarefa'/'pending') e
// create_task já os implica semanticamente; a futura Execution os aplica,
// não esta camada. Deliberadamente SEM proposalId/createdAt/expiresAt
// (pertencem a um futuro ProposalState, não à ação em si), displayText
// (UI/voz futura deriva dos campos estruturados, nunca duplicado aqui) e
// riskLevel/requiresConfirmation (derivados pela futura Confirmation
// Policy a partir do `actionType`, nunca embutidos no dado).
export type ProposedAction =
  | {
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
    }
  | {
      actionType: 'create_calendar_event';
      event: {
        // Verbatim de TaskRef, mesmo princípio de create_local_task acima.
        title: string;
        description: string | null;
        // Sempre um instante ABSOLUTO já resolvido (ISO 8601, UTC) — nunca
        // uma janela civil/relativa. `end` é sempre `start + duration`,
        // calculado uma única vez no builder — nunca duas representações
        // conflitantes do comprimento do evento (nunca um `duration` solto
        // aqui, só o resultado já composto).
        start: string;
        end: string;
        // Necessário mesmo com `start`/`end` já absolutos: a API de
        // eventos do Google exige o par `{dateTime, timeZone}` em cada
        // extremidade — sem isso não há como a Execution (futura, fora
        // desta subfase) montar o payload de criação corretamente.
        timezone: string;
        // Literal fixo nesta V1 — não configurável pelo usuário ainda
        // (ver relatório de mapeamento, seção de lembrete).
        reminderMinutesBeforeStart: 30;
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
// `create_event` continua `unsupported` AQUI de propósito — este builder
// nunca cresce para tratá-lo. A materialização de `create_event` vive em
// `buildCreateCalendarEventAction` (`./calendar-event-proposal.ts`), com
// assinatura própria (`intent`, `now`, `timezone`), porque `create_task`
// nunca precisa de relógio/timezone e `create_event` sempre precisa —
// forçar os dois pelo mesmo builder exigiria mudar esta assinatura (e,
// junto dela, os dois call sites reais em `conversation-turn.ts`) só para
// satisfazer uma variante que esta subfase ainda nem conecta ao pipeline.
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
