-- Hardening de least privilege, escopo global (não só
-- google_calendar_connections): a auditoria anterior (20260831030000)
-- revelou que TRUNCATE/REFERENCES/TRIGGER vinham do default ACL do
-- Postgres para objetos criados por `postgres` em `public` — nunca de
-- nenhuma migration deste repositório. Esse mesmo default ACL também
-- inclui MAINTAIN (privilégio de VACUUM/ANALYZE/CLUSTER/REINDEX,
-- introduzido no Postgres 17 — confirmado: versão remota é PostgreSQL
-- 17.6), que a correção anterior não cobriu, porque a investigação da
-- época só tinha decodificado `D`/`x`/`t` (TRUNCATE/REFERENCES/TRIGGER)
-- sem checar `m`.
--
-- Confirmado via aclexplode(relacl) (decodificação oficial do próprio
-- Postgres, não leitura manual das letras da ACL): `m` = MAINTAIN, e
-- todas as 5 tabelas da aplicação em `public` (brain_dumps,
-- conversation_runtime_states, google_calendar_connections, items,
-- profiles) têm esse privilégio para `authenticated` hoje — nenhuma
-- migration jamais concedeu isso explicitamente (mesmo padrão já
-- confirmado para TRUNCATE/REFERENCES/TRIGGER). Confirmado também: as 5
-- tabelas são todas de propriedade de `postgres` (pg_class.relowner) — o
-- mesmo role usado em `FOR ROLE` na Parte B abaixo.
--
-- Confirmado por leitura de código (sem tocar em nenhuma linha de
-- tabela): zero uso de VACUUM/ANALYZE/CLUSTER/REINDEX (as operações que
-- MAINTAIN autoriza) em `src/` ou em qualquer migration — nenhum fluxo
-- depende disso. TRUNCATE/REFERENCES/TRIGGER já confirmados sem uso na
-- correção anterior.
--
-- Parte A — objetos existentes: revoga os quatro privilégios das 5
-- tabelas da aplicação, listadas explicitamente (nunca
-- `ALL TABLES IN SCHEMA public`, para nunca tocar em objeto fora do que
-- foi auditado). REVOKE de um privilégio já ausente (caso de
-- google_calendar_connections, que já não tinha TRUNCATE/REFERENCES/
-- TRIGGER desde 20260831030000, só MAINTAIN) é um no-op seguro no
-- Postgres, não um erro — por isso as 5 tabelas podem ser tratadas
-- uniformemente numa única instrução. SELECT/INSERT/UPDATE/DELETE de
-- cada tabela nunca fizeram parte do default ACL (confirmado: o default
-- ACL de `authenticated` só tinha D/x/t/m, nunca r/a/w/d) — são
-- concedidos explicitamente por cada migration de criação e permanecem
-- absolutamente intocados aqui. Nenhuma RLS policy é criada, alterada ou
-- removida. `service_role`/`anon` não são mencionados nesta migration; as
-- RPCs de reconexão do Google Calendar (private/public.
-- reconnect_google_calendar) não são tocadas.
--
-- Parte B — objetos futuros: corrige a causa raiz na origem (o default
-- ACL do role `postgres`, dono confirmado de todas as tabelas da
-- aplicação), para que uma tabela nova criada por uma migration futura já
-- nasça sem esses quatro privilégios para `authenticated` — sem precisar
-- de um REVOKE manual repetido em cada nova migration de criação de
-- tabela. Sintaxe (`ALTER DEFAULT PRIVILEGES FOR ROLE ... IN SCHEMA ...
-- REVOKE ... ON TABLES FROM ...`) válida desde muito antes do Postgres 17;
-- a lista de privilégios aceitos por essa cláusula já inclui MAINTAIN
-- desde que esse privilégio existe (17).

-- Parte A: revoga dos objetos existentes -----------------------------------

revoke truncate, references, trigger, maintain
on table
  public.brain_dumps,
  public.conversation_runtime_states,
  public.google_calendar_connections,
  public.items,
  public.profiles
from authenticated;

-- Parte B: corrige o default ACL para tabelas futuras -----------------------

alter default privileges for role postgres in schema public
  revoke truncate, references, trigger, maintain
  on tables
  from authenticated;
