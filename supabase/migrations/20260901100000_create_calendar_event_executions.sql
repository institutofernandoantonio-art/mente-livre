-- Subfase 3 da criação de compromissos no Google Calendar: idempotência e
-- claim atômico da execução — ainda SEM nenhuma chamada ao Google
-- (events.insert continua não implementado; esta migration só prepara o
-- terreno para quando existir).
--
-- LIFECYCLE ADOTADO (revisado após auditoria desta mesma subfase — ver
-- relatório correspondente):
--
--   PROPOSED -> CLAIMED -> GOOGLE EXECUTION -> COMPLETED -> runtime consumida
--
-- O claim NUNCA apaga `conversation_runtime_states`. A ProposalState
-- permanece disponível durante TODA a janela de incerteza da chamada
-- externa ao Google (rede, timeout, resposta perdida) — só uma FUTURA
-- função `finalize_calendar_event_execution` (não implementada nesta
-- subfase) consumirá a runtime, depois que o Google confirmar a criação
-- do evento. Isso é uma correção deliberada em relação ao desenho
-- original desta migration (claim fazia INSERT + DELETE da runtime na
-- mesma transação) — esse desenho linearizava confirm-vs-cancel, mas
-- tornava irrecuperável qualquer timeout/resposta perdida ENTRE o claim e
-- a chamada ao Google: a runtime desaparecia antes de sabermos se o
-- Google sequer foi chamado, e uma nova mensagem do usuário não tinha
-- como reencontrar a proposta original (só reiniciar do zero, gerando um
-- `proposalId` novo e, com ele, um `google_event_id` novo — anulando a
-- própria proteção de idempotência caso o evento anterior já tivesse sido
-- criado). Ver "CONFIRM VS CANCEL" abaixo para a consequência de segurança
-- desta mudança, ainda não resolvida.
--
-- ============================================================================
-- 1. Tabela `calendar_event_executions` — só claim/idempotência/auditoria
-- ============================================================================
--
-- Deliberadamente SEM: access_token, refresh_token, título, descrição,
-- start/end, timezone, reminder, ou qualquer conteúdo do evento — nada
-- disso pertence a uma tabela de idempotência. O CONTEÚDO do evento
-- continua vivendo só dentro do `ProposedAction.event` da ProposalState,
-- que agora sobrevive ao claim exatamente para que uma futura chamada ao
-- Google possa relê-lo sem precisar duplicar nada aqui.
--
-- `proposal_id uuid primary key`: a PK é a própria identidade lógica da
-- proposta (mesmo `proposalId` já gerado por `crypto.randomUUID()` em
-- conversation-turn.ts) — nunca um id sintético novo. Isso já garante, por
-- construção do banco, "no máximo uma execução por proposta", sem precisar
-- de um UNIQUE adicional.
--
-- `google_event_id text not null unique`: UNIQUE nesta coluna, separada da
-- PK, garante também "no máximo uma proposta por google_event_id" — como
-- o id é DERIVADO deterministicamente do proposal_id (ver função abaixo),
-- isso nunca deveria colidir por acaso; o UNIQUE é a garantia estrutural,
-- não uma expectativa.
--
-- `claimed_at`/`completed_at`: o par mínimo que já representa o lifecycle
-- inteiro — `claimed_at` sempre preenchido no momento do claim (default
-- now()); `completed_at` permanece NULL até uma FUTURA função
-- `finalize_calendar_event_execution` (não implementada nesta subfase)
-- marcá-lo, depois de o Google confirmar a criação real do evento. Nenhum
-- enum de status é necessário: `completed_at is null` significa
-- "reivindicado, efeito externo ainda não finalizado"; `completed_at is
-- not null` significará "Google confirmou a criação" — dois campos
-- timestamptz bastam, sem uma terceira coluna de estado redundante.
create table public.calendar_event_executions (
  proposal_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  google_event_id text not null unique,
  claimed_at timestamptz not null default now(),
  completed_at timestamptz null,

  -- Charset base32hex do Google (`0-9`, `a-v`) e comprimento 32 — a
  -- derivação real (ver função abaixo) só produz `[0-9a-f]`, um
  -- subconjunto estrito do charset permitido; esta constraint documenta e
  -- reforça estruturalmente esse contrato, mesmo que a única fonte real
  -- de inserção já garanta isso por construção.
  constraint calendar_event_executions_google_event_id_format
    check (google_event_id ~ '^[0-9a-f]{32}$')
);

comment on table public.calendar_event_executions is
  'Idempotência + auditoria mínima da execução de create_calendar_event —
   NUNCA um cache/replicação do evento em si. Zero conteúdo do evento
   (título/descrição/start/end/timezone/reminder), zero token. Uma linha
   por proposta (proposal_id é a própria PK); google_event_id é sempre
   derivado deterministicamente do proposal_id, nunca aceito de fora.
   completed_at permanece NULL até uma subfase futura (finalize, ainda não
   implementada) que efetivamente confirme a criação no Google Calendar.
   O claim NUNCA apaga a ProposalState correspondente em
   conversation_runtime_states — ela sobrevive até a finalização.';

alter table public.calendar_event_executions enable row level security;

-- Explícito mesmo sendo o padrão de uma tabela nova (o default ACL do
-- role `postgres` em `public` já foi corrigido para nunca conceder
-- TRUNCATE/REFERENCES/TRIGGER/MAINTAIN a `authenticated`, ver
-- 20260831040000) — nenhum SELECT/INSERT/UPDATE/DELETE é concedido
-- diretamente a `authenticated`/`anon` por conveniência. Toda escrita
-- passa exclusivamente pela função abaixo (SECURITY DEFINER), que nunca
-- precisa desses grants para operar.
revoke all on public.calendar_event_executions from authenticated, anon;

-- ============================================================================
-- 2. Função privilegiada — schema `private` (já criado e nunca exposto
-- pela Data API, ver 20260831020000), continuando o mesmo padrão já usado
-- para reconexão do Google Calendar.
-- ============================================================================
--
-- POR QUE SECURITY DEFINER (não INVOKER puro, diferente de
-- confirm_create_local_task): confirm_create_local_task usa INVOKER
-- porque as DUAS tabelas que toca (conversation_runtime_states, items) já
-- tinham, por outros motivos legítimos e pré-existentes, os grants+RLS
-- exatos que o usuário autenticado precisaria de qualquer forma. Aqui não
-- existe esse motivo legítimo pré-existente: `calendar_event_executions`
-- não tem NENHUM caso de uso para o client autenticado ler ou escrever
-- diretamente — sua única razão de existir é servir esta função. Conceder
-- SELECT/INSERT nela só para viabilizar um INVOKER exporia a tabela como
-- endpoint REST direto (Data API expõe qualquer tabela com grant,
-- independente de RLS) sem nenhum benefício. DEFINER aqui é a escolha
-- JUSTIFICADA, não a conveniente.
--
-- RLS é bypassada DENTRO desta função para as tabelas que ela toca (efeito
-- de SECURITY DEFINER) — por isso todo filtro de posse é escrito
-- EXPLICITAMENTE (`user_id = v_user_id`), nunca confiado a uma policy que
-- não se aplica aqui. Mesma disciplina já documentada em
-- private.reconnect_google_calendar.
--
-- `google_event_id` é SEMPRE derivado de `p_proposal_id` dentro da
-- função — nunca aceito como parâmetro, nunca gerado a partir de
-- aleatoriedade nova. Transformação mínima e determinística: remove os
-- hífens do texto canônico do UUID e força minúsculas — 32 caracteres
-- hexadecimais (`[0-9a-f]`), um subconjunto do charset base32hex aceito
-- pelo Google (`0-9`, `a-v`) e dentro do comprimento permitido (5–1024).
--
-- --- TRUST BOUNDARY DE TEMPO (correção desta subfase) ----------------------
--
-- `p_now` foi REMOVIDO da assinatura. A auditoria desta subfase confirmou
-- que `public.claim_calendar_event_execution` é alcançável diretamente por
-- QUALQUER sessão `authenticated` via Data API — um parâmetro de tempo
-- controlado pelo chamador decidindo uma checagem de expiração é uma
-- fronteira de confiança errada: um chamador poderia enviar um `p_now` no
-- passado para fazer uma proposta já expirada parecer válida (nunca
-- cross-user, já que continua restrito ao próprio `auth.uid()`, mas quebra
-- a invariante "proposta expirada nunca é confirmável"). A checagem de
-- expiração agora usa `now()` do próprio Postgres — o mesmo valor, fixo
-- durante toda a transação, já usado por `claimed_at timestamptz not null
-- default now()` nesta mesma tabela — nunca influenciável por nenhum
-- parâmetro de entrada.
--
-- DÍVIDA REGISTRADA, NÃO CORRIGIDA NESTA SUBFASE: `public.
-- confirm_create_local_task` (20260826140000) tem exatamente o mesmo
-- padrão (`p_now timestamptz` recebido e usado em `expires_at > p_now`) e
-- herda o mesmo risco — não cross-user, mas o mesmo tipo de violação da
-- invariante de expiração é tecnicamente possível chamando aquela RPC
-- diretamente com um `p_now` antigo. Fora do escopo desta migration
-- (mexer numa RPC já em produção, que atende create_local_task, não deve
-- ser misturado com esta correção de Calendar) — recomendada uma pequena
-- subfase futura de hardening, só para trocar `p_now` por `now()` ali
-- também, sem qualquer outra mudança de comportamento.
--
-- --- RETRY IDEMPOTENTE DO PRÓPRIO CLAIM -------------------------------
--
-- A checagem de `calendar_event_executions` já existente para
-- (proposal_id, user_id) acontece ANTES de qualquer tentativa de tocar a
-- runtime row — se já existe, devolve `already_claimed` com o MESMO id,
-- sem exigir a runtime ainda viva, sem criar segunda linha, sem gerar novo
-- id, sem tocar `completed_at`, sem qualquer operação Google.
--
-- --- CLAIM NÃO APAGA A RUNTIME (mudança desta subfase) ---------------------
--
-- O caminho de claim novo agora faz só: validar/lockar a ProposalState
-- exata (`for update`, mesma técnica de confirm_create_local_task) e
-- inserir a execução — a ProposalState permanece intacta em
-- `conversation_runtime_states`, disponível para uma futura confirmação
-- reler a MESMA `ProposedAction` e reusar o MESMO `google_event_id` num
-- retry de `events.insert`, e para uma futura `finalize_calendar_event_
-- execution` consumi-la só depois que o Google confirmar.
--
-- --- CONFIRM VS CANCEL (risco registrado, NÃO resolvido nesta subfase) ----
--
-- Como o claim não apaga mais a runtime, o cancelamento GENÉRICO atual
-- (`consumeRuntimeState`, usado por `resolveProposalConversationalTurn`
-- em proposal-turn.ts) continuaria enxergando — e podendo apagar — a MESMA
-- ProposalState mesmo DEPOIS de uma execução já ter sido reivindicada
-- (possivelmente já em andamento ou já criada no Google). Isso não é mais
-- seguro sem uma proteção adicional, ainda não implementada: antes de
-- conectar esta função a qualquer fluxo real de confirmação/cancelamento,
-- o cancelamento de uma proposta `create_calendar_event` precisará
-- verificar, primeiro, se já existe uma linha em
-- `calendar_event_executions` para aquele (proposal_id, user_id) — se
-- existir, cancelar NUNCA deve apagar a runtime nem responder "cancelado";
-- deve retornar um resultado seguro tipo `conflict`/`processing`. Esta
-- migration e `proposal-turn.ts` permanecem SEM essa proteção — é um
-- pré-requisito explícito de uma subfase futura, antes de qualquer
-- Calendar write real ser publicado.
--
-- Conflito (`conflict`) colapsa TODOS os motivos possíveis (state_id
-- obsoleto, runtime de outro usuário, runtime ausente sem execução prévia,
-- proposal_id divergente, runtime expirada, kind errado) — mesma
-- disciplina de `confirm_create_local_task`: nenhuma segunda query tenta
-- "explicar" a causa, nenhum retry, nenhum requery.
create or replace function private.claim_calendar_event_execution(
  p_expected_state_id uuid,
  p_proposal_id uuid
)
returns table (status text, google_event_id text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_payload jsonb;
  v_existing_event_id text;
  v_new_event_id text;
begin
  -- Defesa em profundidade: qualquer comparação com `v_user_id` null já
  -- não bateria com nenhuma linha real (NULL nunca é igual a nada em
  -- SQL), então este caminho já cairia em `conflict` mesmo sem esta
  -- checagem explícita — mantida mesmo assim por clareza, nunca confiada
  -- implicitamente a essa semântica de NULL.
  if v_user_id is null then
    return query select 'conflict'::text, null::text;
    return;
  end if;

  -- Retry do próprio claim: se já existe uma execução para este
  -- (proposal_id, user_id), a resposta é sempre a mesma, independente do
  -- estado atual da runtime row.
  select e.google_event_id
    into v_existing_event_id
    from public.calendar_event_executions e
   where e.proposal_id = p_proposal_id
     and e.user_id = v_user_id;

  if found then
    return query select 'already_claimed'::text, v_existing_event_id;
    return;
  end if;

  -- Caminho novo: exige a runtime row exata, do próprio usuário, ainda
  -- válida (`now()` do Postgres, nunca um `p_now` do chamador — ver TRUST
  -- BOUNDARY DE TEMPO acima), kind proposal, com o MESMO proposal_id
  -- dentro do payload — `for update` trava a linha para a duração da
  -- transação (mesma técnica de confirm_create_local_task), serializando
  -- com qualquer consume/advance concorrente sobre a MESMA linha via MVCC
  -- do Postgres, sem mutex de aplicação.
  select c.payload
    into v_payload
    from public.conversation_runtime_states c
   where c.user_id = v_user_id
     and c.state_id = p_expected_state_id
     and c.state_kind = 'proposal'
     and c.expires_at > now()
     and (c.payload ->> 'proposalId') = p_proposal_id::text
   for update;

  if not found then
    return query select 'conflict'::text, null::text;
    return;
  end if;

  v_new_event_id := lower(replace(p_proposal_id::text, '-', ''));

  insert into public.calendar_event_executions (proposal_id, user_id, google_event_id)
  values (p_proposal_id, v_user_id, v_new_event_id);

  -- NUNCA apaga a runtime aqui (ver "CLAIM NÃO APAGA A RUNTIME" acima) —
  -- a ProposalState permanece disponível até uma futura
  -- finalize_calendar_event_execution consumi-la.

  return query select 'claimed'::text, v_new_event_id;
end;
$$;

-- `authenticated` já tem USAGE no schema `private` desde 20260831020000
-- (reconexão do Calendar) — nada a reconceder aqui, só o EXECUTE desta
-- função específica.
revoke all on function private.claim_calendar_event_execution(uuid, uuid) from public;
grant execute on function private.claim_calendar_event_execution(uuid, uuid) to authenticated;

-- ============================================================================
-- 3. Wrapper público (schema public, exposto pela Data API) — único ponto
-- alcançável por `supabase.rpc('claim_calendar_event_execution', ...)`.
-- SECURITY INVOKER: não precisa de privilégio próprio nenhum, só repassa a
-- chamada — toda a autoridade real está na função privada acima. Mesmo
-- padrão exato de public.reconnect_google_calendar.
-- ============================================================================
create or replace function public.claim_calendar_event_execution(
  p_expected_state_id uuid,
  p_proposal_id uuid
)
returns table (status text, google_event_id text)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return query
    select * from private.claim_calendar_event_execution(p_expected_state_id, p_proposal_id);
end;
$$;

revoke all on function public.claim_calendar_event_execution(uuid, uuid) from public;
grant execute on function public.claim_calendar_event_execution(uuid, uuid) to authenticated;
