-- Least privilege: `authenticated` tinha REFERENCES/TRIGGER/TRUNCATE em
-- google_calendar_connections sem nenhuma migration deste repositório ter
-- concedido isso — é a default privilege do Postgres para objetos criados
-- por `postgres` no schema `public` (confirmado via pg_default_acl:
-- authenticated=Dxtm/postgres), aplicada automaticamente a toda tabela
-- nova. A migration original (20260824000125) revogou tudo de `anon` e
-- concedeu só INSERT a `authenticated`, mas nunca revogou o default
-- remanescente de `authenticated`.
--
-- Confirmado (investigação read-only, sem leitura de refresh_token):
-- nenhuma foreign key em qualquer migration referencia
-- google_calendar_connections, nenhum trigger é definido nesta tabela,
-- nenhum código em src/ usa TRUNCATE — os três privilégios não são usados
-- por nenhum fluxo atual da aplicação nem pela RPC de reconexão
-- (private/public.reconnect_google_calendar, migration 20260831020000,
-- que já não depende de nenhum GRANT de tabela para `authenticated`).
--
-- INSERT é preservado (única operação direta na tabela que a aplicação
-- ainda usa — nunca chamada em código hoje, mas mantida por não ter sido
-- pedida sua remoção). Nenhuma alteração em `service_role`/`postgres`.

revoke references, trigger, truncate
on public.google_calendar_connections
from authenticated;
