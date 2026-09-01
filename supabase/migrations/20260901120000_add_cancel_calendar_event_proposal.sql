-- Subfase 5 da criação de compromissos no Google Calendar: cancelamento
-- protegido de uma ProposalState `create_calendar_event` — elimina a
-- corrida perigosa em que um cancelamento genérico (`consumeRuntimeState`)
-- poderia apagar a runtime e responder "cancelado" DEPOIS que um claim já
-- tivesse vencido (ver "CONFIRM VS CANCEL", registrado como pré-requisito
-- não resolvido em 20260901100000 e reafirmado em
-- 20260901110000_add_finalize_calendar_event_execution.sql).
--
-- Esta migration é estritamente ADITIVA sobre 20260901100000
-- (create_calendar_event_executions) e 20260901110000
-- (add_finalize_calendar_event_execution) — nenhuma linha de nenhuma das
-- duas é reescrita aqui; nenhuma tabela/coluna/constraint nova é criada;
-- a única adição é a função de cancelamento (privada + wrapper público).
--
-- Esta migration NUNCA chama o Google Calendar, NUNCA cancela um evento
-- real no Google, e NUNCA implementa o lifecycle positivo ("sim" →
-- claim). Depois que um claim já venceu, "não" significa exatamente isto:
-- "não posso mais cancelar esta proposta localmente com segurança" —
-- nunca "o evento foi desfeito".
--
-- ============================================================================
-- CONTRATO DA FUNÇÃO
-- ============================================================================
--
-- private.cancel_calendar_event_proposal(p_expected_state_id uuid,
-- p_proposal_id uuid) — mesma assinatura mínima do claim/finalize,
-- deliberadamente SEM p_now/user_id/google_event_id/token/payload do
-- evento:
--
-- - SEM p_now: mesmo trust boundary já corrigido no claim/finalize —
--   nenhuma decisão de tempo depende de valor vindo do chamador. Esta
--   função (diferente de finalize) AINDA valida expiração — mas usando
--   `now()` do próprio Postgres, nunca um parâmetro do chamador.
-- - SEM user_id: deriva de auth.uid(), nunca aceito de fora.
-- - SEM google_event_id/token/payload do evento: cancelamento nunca
--   precisa ler nem devolver conteúdo do evento — só decide entre três
--   status.
--
-- Retorno: `returns table (status text)` — só o status, nenhuma coluna
-- extra, nenhum id, nenhum conteúdo da proposta.
--
-- status possíveis: 'cancelled' | 'execution_started' | 'conflict'.
-- Nenhum quarto valor. `error` não é um status desta função — mesma
-- convenção do claim/finalize (falha técnica de rede/RPC é conceito
-- exclusivo do wrapper TypeScript).
--
-- ============================================================================
-- POR QUE ESTA RPC EXISTE (por que NÃO usar consumeRuntimeState aqui)
-- ============================================================================
--
-- `consumeRuntimeState` (runtime-state-storage.ts) já garante CAS sobre
-- `conversation_runtime_states` sozinha — mas nunca soube, e nunca deveria
-- saber, sobre `calendar_event_executions`. Fazer "ler execution, depois
-- consumir runtime" como DUAS operações TypeScript teria uma corrida real:
-- entre a leitura e o consume, um claim concorrente poderia vencer, e o
-- consume ainda apagaria a runtime e responderia "cancelado" mesmo com uma
-- execução já reivindicada. A única forma de decidir atomicamente "ainda
-- posso cancelar" vs. "a execução já começou" é uma ÚNICA transação
-- Postgres que segura o lock da runtime ANTES de decidir — exatamente o
-- que esta função faz.
--
-- ============================================================================
-- ORDEM DE LOCKS — verificada compatível com claim e finalize
-- ============================================================================
--
-- Ordem adotada aqui: RUNTIME primeiro (`conversation_runtime_states` via
-- `for update`), EXECUTION depois (`calendar_event_executions` via `for
-- update`). Idêntica à ordem já usada por
-- private.claim_calendar_event_execution (20260901100000) e por
-- private.finalize_calendar_event_execution (20260901110000) — ver os
-- comentários "ORDEM DE LOCKS" de cada uma. Nenhuma das três funções
-- jamais tenta travar EXECUTION antes de RUNTIME.
--
-- Três funções que sempre adquirem locks na MESMA ordem nunca formam uma
-- espera circular entre si, para qualquer combinação de chamadas
-- concorrentes — cada uma que perder a corrida pelo lock de RUNTIME
-- simplesmente espera a outra transação commitar/abortar antes de
-- prosseguir; nenhuma delas jamais segura EXECUTION enquanto espera por
-- RUNTIME. Nenhuma incompatibilidade foi encontrada entre as três — não
-- há necessidade de parar e redesenhar nenhuma delas por causa de ordem
-- de locks.
--
-- ============================================================================
-- PROVA DO RACE CLAIM vs CANCEL — os dois interleavings possíveis
-- ============================================================================
--
-- Interleaving 1 — CANCEL pega o lock da runtime primeiro:
--   1. cancel trava a runtime (`for update`), valida identidade/kind/
--      actionType/expiração — tudo bate;
--   2. cancel verifica calendar_event_executions: NÃO existe (claim ainda
--      não rodou, ou está bloqueado esperando o MESMO lock de runtime que
--      cancel já segura — não pode ter inserido nada ainda);
--   3. cancel apaga a runtime exata e faz COMMIT, liberando o lock;
--   4. o claim que estava esperando finalmente adquire o lock de runtime —
--      mas a linha já não existe mais (`not found`) → claim retorna
--      'conflict';
--   5. zero chamada futura ao Google acontece para esta proposta (o claim
--      nunca chega a inserir em calendar_event_executions).
--
-- Interleaving 2 — CLAIM pega o lock da runtime primeiro:
--   1. claim trava a runtime, valida, insere a linha em
--      calendar_event_executions, e faz COMMIT MANTENDO a runtime intacta
--      (comportamento já corrigido em 20260901100000);
--   2. o cancel que estava esperando finalmente adquire o lock de runtime
--      — a linha ainda existe (claim nunca a apaga);
--   3. cancel verifica calendar_event_executions: a linha do claim já está
--      commitada e visível → 'execution_started';
--   4. a runtime PERMANECE intacta (cancel nunca apaga, nunca altera
--      execution) — o lifecycle CLAIMED -> GOOGLE -> FINALIZE continua
--      possível;
--   5. nenhum "cancelado" falso é reportado ao usuário.
--
-- Em nenhum dos dois interleavings o usuário pode receber "cancelado"
-- depois de um claim já ter vencido — a propriedade central desta
-- subfase.
--
-- ============================================================================
-- RACE COM FINALIZE
-- ============================================================================
--
-- finalize também usa RUNTIME -> EXECUTION (ver 20260901110000) — mesma
-- ordem, mesma compatibilidade.
--
-- Cenário "finalize vence": finalize marca completed_at e apaga a runtime
-- na MESMA transação; qualquer cancel que chegue depois trava a busca pela
-- runtime e não encontra nada (já apagada) -> 'conflict'. Nunca reporta
-- "cancelado" para uma proposta cujo evento já foi (ou está prestes a ser)
-- confirmado.
--
-- Cenário "cancel chega enquanto a execution já existe" (claimed OU já
-- completed, caso — impossível sob concorrência correta — a runtime ainda
-- exista com completed_at preenchido): cancel encontra a linha de
-- execution e retorna 'execution_started', nunca bloqueia, nunca finge
-- cancelamento, nunca tenta "desfazer" nada.
--
-- Esta migration NUNCA tenta cancelar um evento no Google Calendar — isso
-- permanece inteiramente fora de escopo. "não", depois de um claim já
-- vencido, significa apenas que o cancelamento local não é mais seguro.
--
-- ============================================================================
-- ALGORITMO
-- ============================================================================
--
-- Passo A — autenticação: auth.uid() obrigatório; nulo -> conflict
-- (mesma defesa em profundidade de claim/finalize: NULL nunca bateria com
-- nenhuma linha real de qualquer forma).
--
-- Passo B — lock da runtime (`for update`): localizar
-- conversation_runtime_states por user_id = auth.uid() e state_id =
-- p_expected_state_id, exigindo TODAS as condições simultaneamente:
--   - state_kind = 'proposal' (nunca cancela uma clarificação por aqui);
--   - (payload ->> 'proposalId') = p_proposal_id::text (mesma identidade
--     que o claim já usa);
--   - (payload -> 'action' ->> 'actionType') = 'create_calendar_event' —
--     esta RPC nunca cancela create_local_task (que continua usando
--     consumeRuntimeState, sem qualquer mudança);
--   - expires_at > now() do próprio Postgres (nunca p_now) — diferente de
--     finalize, cancelar uma proposta ainda é uma decisão sobre uma
--     proposta ATIVA, então o TTL continua relevante aqui.
-- Se não encontrar -> 'conflict' (colapsa TODOS os motivos possíveis:
-- state_id obsoleto, runtime de outro usuário, runtime ausente, kind
-- errado, actionType errado, proposalId divergente, ou expirada — mesma
-- disciplina anti-TOCTOU de toda a pilha: nenhuma segunda query tenta
-- "explicar" a causa).
--
-- Passo C — verificar execution (`for update`, mesma tabela que claim/
-- finalize já protegem com lock coerente): localizar
-- calendar_event_executions por proposal_id = p_proposal_id e user_id =
-- auth.uid().
--   - Se NÃO existir: claim ainda não venceu. Na MESMA transação: DELETE
--     da runtime exata (mesmo filtro user_id + state_id de
--     confirm_create_local_task/finalize) e retorna 'cancelled'.
--   - Se existir (claimed ou já completed): claim já venceu. NUNCA apaga a
--     runtime, NUNCA altera a execution/completed_at, NUNCA tenta desfazer
--     o claim, NUNCA tenta cancelar o evento no Google. Retorna
--     'execution_started' — a runtime permanece intacta, disponível para
--     o lifecycle CLAIMED -> GOOGLE -> FINALIZE continuar normalmente.
--
-- ============================================================================
-- SEGURANÇA SQL — idêntica a claim/finalize
-- ============================================================================
--
-- private.cancel_calendar_event_proposal: SECURITY DEFINER, mesmo
-- racional já documentado em 20260901100000/20260901110000
-- (calendar_event_executions não tem nenhum caso de uso de acesso direto
-- pelo client autenticado). RLS é bypassada dentro da função (efeito de
-- DEFINER) — todo filtro de posse continua explícito (`user_id =
-- v_user_id`), nunca confiado a uma policy que não se aplica aqui.
--
-- public.cancel_calendar_event_proposal: SECURITY INVOKER, só repassa a
-- chamada — mesmo padrão exato dos wrappers públicos de claim/finalize.
--
-- search_path fixado em '' nas duas, toda referência schema-qualified.
-- Grants mínimos: revoke de public, grant de EXECUTE só para
-- authenticated, nas duas funções — nenhum grant a anon/service_role,
-- nenhum grant direto novo em calendar_event_executions/
-- conversation_runtime_states, nenhum CREATE novo no schema private.
create or replace function private.cancel_calendar_event_proposal(
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
begin
  -- Defesa em profundidade: mesmo racional de claim/finalize — NULL nunca
  -- bateria com nenhuma linha real de qualquer forma, mas a checagem
  -- explícita nunca é confiada implicitamente a essa semântica.
  if v_user_id is null then
    return query select 'conflict'::text;
    return;
  end if;

  -- Passo B (RUNTIME primeiro, ver "ORDEM DE LOCKS" acima): trava a
  -- ProposalState exata do usuário, exigindo kind proposal, proposalId
  -- correto, actionType create_calendar_event (nunca cancela
  -- create_local_task por aqui) e TTL ainda válido (now() do próprio
  -- Postgres, nunca p_now).
  perform 1
    from public.conversation_runtime_states c
   where c.user_id = v_user_id
     and c.state_id = p_expected_state_id
     and c.state_kind = 'proposal'
     and c.expires_at > now()
     and (c.payload ->> 'proposalId') = p_proposal_id::text
     and (c.payload -> 'action' ->> 'actionType') = 'create_calendar_event'
   for update;

  v_runtime_found := found;

  if not v_runtime_found then
    return query select 'conflict'::text;
    return;
  end if;

  -- Passo C: trava (se existir) a execução correspondente — mesma tabela,
  -- mesmo filtro de posse que claim/finalize já usam.
  perform 1
    from public.calendar_event_executions e
   where e.proposal_id = p_proposal_id
     and e.user_id = v_user_id
   for update;

  v_execution_found := found;

  if v_execution_found then
    -- Claim já venceu: NUNCA apaga a runtime, NUNCA altera a execution,
    -- NUNCA tenta desfazer nada. A runtime permanece intacta para o
    -- lifecycle CLAIMED -> GOOGLE -> FINALIZE continuar.
    return query select 'execution_started'::text;
    return;
  end if;

  -- Claim ainda não venceu: cancela atomicamente — apaga a runtime exata
  -- e retorna 'cancelled'.
  delete from public.conversation_runtime_states
   where user_id = v_user_id
     and state_id = p_expected_state_id;

  return query select 'cancelled'::text;
end;
$$;

-- `authenticated` já tem USAGE no schema `private` desde 20260831020000 —
-- nada a reconceder, só o EXECUTE desta função específica.
revoke all on function private.cancel_calendar_event_proposal(uuid, uuid) from public;
grant execute on function private.cancel_calendar_event_proposal(uuid, uuid) to authenticated;

-- Wrapper público (schema public, exposto pela Data API) — único ponto
-- alcançável por `supabase.rpc('cancel_calendar_event_proposal', ...)`.
-- SECURITY INVOKER: não precisa de privilégio próprio, só repassa a
-- chamada — mesmo padrão exato dos wrappers públicos de claim/finalize.
create or replace function public.cancel_calendar_event_proposal(
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
    select * from private.cancel_calendar_event_proposal(p_expected_state_id, p_proposal_id);
end;
$$;

revoke all on function public.cancel_calendar_event_proposal(uuid, uuid) from public;
grant execute on function public.cancel_calendar_event_proposal(uuid, uuid) to authenticated;
