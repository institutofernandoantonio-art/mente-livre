-- BYPASSRLS e GRANT são camadas diferentes: a Secret Key/service_role
-- contorna a RLS, mas ainda precisa de privilégio de tabela para executar
-- SELECT via Data API (PostgREST) — confirmado por leitura de
-- information_schema.role_table_grants: service_role tinha só
-- REFERENCES/TRIGGER/TRUNCATE, nunca SELECT, nesta tabela. Esta é a causa
-- confirmada de connectionErrorCode 42501 (permission) na leitura
-- privilegiada de google_calendar_connections (Fase 7, leitura de
-- disponibilidade). Nenhum outro privilégio muda: authenticated e anon
-- continuam sem SELECT (ver migration original da tabela).
grant select
on table public.google_calendar_connections
to service_role;
