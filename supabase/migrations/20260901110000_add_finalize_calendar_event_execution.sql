-- Subfase 4 da criação de compromissos no Google Calendar: finalização
-- atômica da execução — a operação que só deve ser chamada DEPOIS que uma
-- futura camada de Google Calendar já souber que o evento existe (foi
-- criado agora, ou já existia de uma tentativa anterior). Esta migration
-- em si NUNCA chama o Google — só oferece "Google já confirmou; agora
-- finalize localmente com segurança" para quem chamar depois de ter essa
-- confirmação em mãos. `events.insert` continua não implementado em
-- `../google/calendar`.
--
-- Esta migration é estritamente ADITIVA sobre 20260901100000
-- (create_calendar_event_executions) — nenhuma linha daquela migration é
-- reescrita aqui; nenhuma tabela/coluna/constraint nova é criada; a única
-- adição é a função de finalização (privada + wrapper público), simétrica
-- ao par claim já existente.
--
-- LIFECYCLE COMPLETO (claim já implementado em 20260901100000, finalize
-- implementado aqui):
--
--   PROPOSED -> CLAIMED -> GOOGLE EXECUTION -> FINALIZE -> COMPLETED
--                                                (completed_at = now();
--                                                 runtime consumida)
--
-- ============================================================================
-- CONTRATO DA FUNÇÃO
-- ============================================================================
--
-- private.finalize_calendar_event_execution(p_expected_state_id uuid,
-- p_proposal_id uuid) — mesma assinatura mínima do claim, deliberadamente
-- SEM p_now/user_id/google_event_id/payload/tokens:
--
-- - SEM p_now: mesmo trust boundary já corrigido no claim (20260901100000)
--   — nenhuma decisão de tempo depende de valor vindo do chamador. Mas
--   aqui a ausência de tempo vai além disso — ver "TTL NÃO BLOQUEIA
--   FINALIZE" logo abaixo: finalize não tem NENHUMA checagem de tempo,
--   nem do chamador nem do próprio Postgres.
-- - SEM user_id: deriva de auth.uid(), nunca aceito de fora.
-- - SEM google_event_id: quem chama finalize (a futura camada de Google)
--   já sabe qual é — foi ela quem acabou de usá-lo para criar o evento.
--   Esta função não precisa devolvê-lo de volta.
-- - SEM payload/conteúdo do evento: finalize nunca lê nem precisa do
--   `ProposedAction` — só confirma a identidade da proposta (mesmo padrão
--   do claim) e decide o resultado.
--
-- Retorno: `returns table (status text)` — só o status, nenhuma coluna
-- extra (diferente do claim, que devolve também google_event_id porque
-- quem chama claim ainda não tem o id; quem chama finalize já tem tudo
-- que precisa).
--
-- status possíveis: 'completed' | 'already_completed' | 'conflict'.
-- Nenhum quarto valor. `error` não é um status desta função — é um
-- conceito exclusivo do wrapper TypeScript (falha técnica de rede/RPC),
-- nunca produzido pela função SQL em si (mesma convenção do claim).
--
-- ============================================================================
-- ORDEM DE LOCKS — verificada compatível com o claim atual
-- ============================================================================
--
-- Ordem adotada aqui: RUNTIME primeiro (`conversation_runtime_states` via
-- `for update`), EXECUTION depois (`calendar_event_executions` via `for
-- update`, só quando a runtime foi encontrada e uma escrita está prestes a
-- acontecer). NUNCA a ordem inversa.
--
-- Auditoria da ordem REAL usada pelo claim atual (20260901100000), feita
-- antes de escrever esta função: o claim faz primeiro um SELECT NÃO
-- travado (sem `for update`) em `calendar_event_executions` (só para o
-- retorno idempotente `already_claimed`, sem nenhuma escrita
-- dependendo dele) e só DEPOIS trava `conversation_runtime_states` via
-- `for update`; a única operação do claim sobre
-- `calendar_event_executions` que efetivamente cria um lock é o INSERT
-- final, que ocorre DEPOIS do lock de runtime. Ou seja: o claim nunca
-- efetivamente SEGURA um lock em `calendar_event_executions` antes de
-- segurar (ou tentar segurar) o lock de `conversation_runtime_states` — a
-- leitura inicial não travada não conta como uma aquisição de lock que
-- possa formar uma espera circular. A ordem real de AQUISIÇÃO DE LOCKS do
-- claim já é, na prática, RUNTIME -> EXECUTION (o INSERT que trava a nova
-- linha de EXECUTION só acontece depois do `for update` em RUNTIME).
--
-- Isso é COMPATÍVEL com a ordem adotada aqui: as duas funções sempre
-- tentam travar RUNTIME antes de EXECUTION, nunca o inverso — não existe
-- nenhuma combinação de chamadas concorrentes entre claim e finalize (ou
-- finalize e finalize) que produza espera circular. Uma chamada que
-- perder a corrida pelo lock de RUNTIME simplesmente espera a outra
-- transação terminar (commit/rollback) antes de prosseguir; nenhuma das
-- duas jamais segura EXECUTION enquanto espera por RUNTIME. Nenhuma
-- incompatibilidade foi encontrada — não há necessidade de parar e
-- redesenhar esta função por causa de ordem de locks.
--
-- ============================================================================
-- TTL NÃO BLOQUEIA FINALIZE (decisão explícita desta subfase)
-- ============================================================================
--
-- Diferente do claim, esta função NUNCA verifica `expires_at`. O claim já
-- validou, no seu próprio instante, que a proposta estava dentro do TTL —
-- essa validação não precisa (e não deve) ser repetida aqui. Exemplo
-- concreto: claim acontece às 14:29:59 (proposta expira às 14:30:00,
-- ainda válida por 1 segundo); a chamada ao Google demora; finalize só é
-- chamado às 14:30:01, um segundo DEPOIS do TTL original já ter vencido.
-- Se finalize revalidasse `expires_at`, este finalize legítimo falharia
-- com `conflict` mesmo o Google já tendo criado o evento de verdade —
-- produzindo exatamente o cenário que esta subfase existe para evitar:
-- evento criado no Google, mas o sistema local nunca reconhece isso,
-- deixando a runtime "presa" indefinidamente e arriscando um usuário
-- tentar de novo (o que o `google_event_id` determinístico do claim já
-- protegeria contra duplicação, mas ainda seria uma experiência confusa).
-- Finalize identifica a proposta certa (state_id + proposal_id, mesmo
-- padrão do claim) e finaliza incondicionalmente quanto a tempo — a única
-- coisa que finalize verifica é IDENTIDADE (é esta a proposta certa, deste
-- usuário) e CONSISTÊNCIA DE ESTADO (branches abaixo), nunca TTL.
--
-- ============================================================================
-- ALGORITMO — 4 branches
-- ============================================================================
--
-- A. Runtime EXISTE (mesmo user_id/state_id/proposal_id do claim) e a
--    execução correspondente está PENDING (completed_at IS NULL): este é
--    o caminho normal de sucesso. Na MESMA transação: UPDATE
--    calendar_event_executions SET completed_at = now(), e DELETE da
--    linha exata da runtime (mesmo filtro user_id+state_id de
--    confirm_create_local_task). Retorna 'completed'.
--
-- B. Runtime EXISTE, mas a execução já está COMPLETED (completed_at IS
--    NOT NULL): combinação IMPOSSÍVEL sob o fluxo normal, porque o branch
--    A sempre apaga a runtime na MESMA transação em que marca
--    completed_at — se ambas coexistem, algo saiu do script esperado.
--    Tratada como inconsistência e NUNCA autocorrigida: nunca apaga a
--    runtime aqui, nunca sobrescreve completed_at. Retorna 'conflict'.
--
-- C. Runtime AUSENTE, execução do próprio usuário já COMPLETED: retry de
--    uma resposta HTTP perdida DEPOIS que um finalize anterior já
--    commitou (a runtime já foi apagada por aquele finalize). Nunca
--    reescreve completed_at, nunca recria a runtime — só confirma que já
--    aconteceu. Retorna 'already_completed'.
--
-- D. Qualquer outra combinação — runtime AUSENTE e execução AUSENTE;
--    runtime AUSENTE e execução PENDING (estado impossível sob
--    concorrência correta, já que o branch A é atômico); runtime EXISTE
--    mas nunca houve claim (execução ausente); ou a execução pertence a
--    OUTRO usuário (nunca visível aqui, porque toda consulta já filtra
--    por user_id = auth.uid(), mesma disciplina do claim — a existência
--    de uma execução de outro usuário nunca é revelada, colapsa
--    uniformemente no mesmo 'conflict' que qualquer outro motivo).
--    Retorna 'conflict', sem nenhuma segunda query tentando "explicar" a
--    causa (mesma disciplina anti-TOCTOU de toda a pilha).
--
-- ============================================================================
-- SEGURANÇA SQL — idêntica ao claim
-- ============================================================================
--
-- private.finalize_calendar_event_execution: SECURITY DEFINER, mesmo
-- racional já documentado em 20260901100000 para o claim
-- (calendar_event_executions não tem nenhum caso de uso de acesso direto
-- pelo client autenticado; conceder grant nela só para viabilizar INVOKER
-- exporia a tabela como endpoint REST sem benefício real). RLS é
-- bypassada dentro da função (efeito de DEFINER) — todo filtro de posse
-- continua explícito (`user_id = v_user_id`), nunca confiado a uma policy
-- que não se aplica aqui.
--
-- public.finalize_calendar_event_execution: SECURITY INVOKER, só repassa
-- a chamada — mesmo padrão exato do wrapper público do claim.
--
-- search_path fixado em '' nas duas, toda referência schema-qualified.
-- Grants mínimos: revoke de public, grant de EXECUTE só para
-- authenticated, nas duas funções — nenhum grant a anon/service_role.
--
-- ============================================================================
-- LIMITAÇÃO REGISTRADA — resposta HTTP perdida DEPOIS do finalize (V1,
-- aceita, não resolvida aqui)
-- ============================================================================
--
-- Se a resposta HTTP inteira se perder DEPOIS que finalize já commitou
-- (a runtime já foi consumida), o dispatcher conversacional normal não
-- consegue reconstruir aquela proposta específica a partir de um novo
-- "sim" solto do usuário (não há mais runtime para casar). Esta subfase
-- aceita isso como uma lacuna de UX da V1 — NÃO tentada resolver aqui com
-- histórico de conversas, ids de browser, uma nova tabela de mensagens,
-- worker, ou polling. A propriedade crítica que esta migration preserva é
-- "o evento não será duplicado" (o google_event_id determinístico do
-- claim já garante isso mesmo neste cenário) — nunca "toda resposta é
-- sempre reconstruível".
--
-- ============================================================================
-- PRÉ-REQUISITO AINDA PENDENTE — cancelamento seguro (próxima subfase)
-- ============================================================================
--
-- O risco "CONFIRM VS CANCEL" registrado em 20260901100000 permanece
-- inteiramente sem solução aqui: o cancelamento genérico atual
-- (`consumeRuntimeState`, usado por `resolveProposalConversationalTurn` em
-- proposal-turn.ts) ainda pode apagar a MESMA runtime que um claim (ou
-- agora também um finalize) está processando, sem checar
-- `calendar_event_executions` antes. Esta migration não conecta finalize
-- a nenhum fluxo real, não altera proposal-turn.ts, e não implementa
-- nenhuma proteção de cancelamento — isso continua sendo um pré-requisito
-- explícito de uma subfase futura, antes de qualquer Calendar write real
-- ser publicado.
create or replace function private.finalize_calendar_event_execution(
  p_expected_state_id uuid,
  p_proposal_id uuid
)
returns table (status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_runtime_found boolean := false;
  v_execution_found boolean := false;
  v_completed_at timestamptz;
begin
  -- Defesa em profundidade: mesmo racional do claim — NULL nunca bateria
  -- com nenhuma linha real de qualquer forma, mas a checagem explícita
  -- nunca é confiada implicitamente a essa semântica.
  if v_user_id is null then
    return query select 'conflict'::text;
    return;
  end if;

  -- Passo 1 (RUNTIME primeiro, ver "ORDEM DE LOCKS" acima): trava a
  -- ProposalState exata do usuário, se ainda existir. Deliberadamente SEM
  -- `and expires_at > ...` — ver "TTL NÃO BLOQUEIA FINALIZE" acima.
  perform 1
    from public.conversation_runtime_states c
   where c.user_id = v_user_id
     and c.state_id = p_expected_state_id
     and c.state_kind = 'proposal'
     and (c.payload ->> 'proposalId') = p_proposal_id::text
   for update;

  v_runtime_found := found;

  if v_runtime_found then
    -- Passo 2: runtime existe — trava (se existir) a execução
    -- correspondente para decidir entre o branch A (pending -> finaliza)
    -- e o branch B (já completed -> inconsistência).
    select e.completed_at
      into v_completed_at
      from public.calendar_event_executions e
     where e.proposal_id = p_proposal_id
       and e.user_id = v_user_id
     for update;

    v_execution_found := found;

    if not v_execution_found then
      -- Runtime existe mas nunca houve claim — estado inesperado; finalize
      -- nunca cria uma execução (isso é papel exclusivo do claim), nunca
      -- apaga a runtime neste caso. Colapsa em conflict.
      return query select 'conflict'::text;
      return;
    end if;

    if v_completed_at is not null then
      -- Branch B: inconsistência (ver algoritmo acima) — nunca
      -- autocorrigida.
      return query select 'conflict'::text;
      return;
    end if;

    -- Branch A: finalização real, atômica — completed_at recebe now() e a
    -- runtime exata é apagada na MESMA transação.
    update public.calendar_event_executions
       set completed_at = now()
     where proposal_id = p_proposal_id
       and user_id = v_user_id;

    delete from public.conversation_runtime_states
     where user_id = v_user_id
       and state_id = p_expected_state_id;

    return query select 'completed'::text;
    return;
  end if;

  -- Runtime ausente — só resta decidir entre already_completed (branch C,
  -- retry de resposta perdida) e conflict (branch D, qualquer outra
  -- combinação). Nenhuma escrita acontece a partir daqui, então nenhum
  -- `for update` é necessário (mesma disciplina do claim para o seu
  -- caminho de retorno antecipado `already_claimed`).
  select e.completed_at
    into v_completed_at
    from public.calendar_event_executions e
   where e.proposal_id = p_proposal_id
     and e.user_id = v_user_id;

  v_execution_found := found;

  if v_execution_found and v_completed_at is not null then
    return query select 'already_completed'::text;
    return;
  end if;

  -- Branch D: cobre runtime ausente + execução ausente, runtime ausente +
  -- execução pending (impossível sob concorrência correta), e qualquer
  -- execução que pertença a outro usuário (nunca visível aqui).
  return query select 'conflict'::text;
end;
$$;

-- `authenticated` já tem USAGE no schema `private` desde 20260831020000 —
-- nada a reconceder, só o EXECUTE desta função específica.
revoke all on function private.finalize_calendar_event_execution(uuid, uuid) from public;
grant execute on function private.finalize_calendar_event_execution(uuid, uuid) to authenticated;

-- Wrapper público (schema public, exposto pela Data API) — único ponto
-- alcançável por `supabase.rpc('finalize_calendar_event_execution', ...)`.
-- SECURITY INVOKER: não precisa de privilégio próprio, só repassa a
-- chamada — mesmo padrão exato do wrapper público do claim.
create or replace function public.finalize_calendar_event_execution(
  p_expected_state_id uuid,
  p_proposal_id uuid
)
returns table (status text)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return query
    select * from private.finalize_calendar_event_execution(p_expected_state_id, p_proposal_id);
end;
$$;

revoke all on function public.finalize_calendar_event_execution(uuid, uuid) from public;
grant execute on function public.finalize_calendar_event_execution(uuid, uuid) to authenticated;
