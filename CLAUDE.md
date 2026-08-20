@AGENTS.md

# Instruções permanentes — Mente Livre

`AGENTS.md` (importado acima) é gerado e regravado automaticamente pelo
`next dev` — nunca editar esse arquivo manualmente. As instruções do
projeto em si ficam aqui, abaixo.

## Leitura obrigatória antes de qualquer mudança estrutural

- [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md) — visão do produto, estado
  atual, fases e pendências.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — stack, estrutura de
  pastas, desenho do banco.
- [`docs/SECURITY.md`](docs/SECURITY.md) — princípios e mecanismos de
  segurança (RLS, segredos, teste de isolamento).
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — decisões técnicas específicas,
  com data e motivo.

## Regras não-negociáveis

- **RLS explícito por operação** em toda tabela nova — política própria
  para SELECT, INSERT, UPDATE e DELETE; nunca `FOR ALL` genérico.
- **Nenhuma `service_role` key no frontend.** Segredos só em rotas de
  backend do servidor.
- **Tema sempre claro** — o produto nunca fica escuro, mesmo com o SO do
  usuário em modo escuro. Não adicionar `@media (prefers-color-scheme: dark)`.
- **Banco criado incrementalmente**, uma tabela por fase — não antecipar
  tabelas de fases futuras (ver `docs/ARCHITECTURE.md`, seção "Banco de
  dados").
- **Referência visual não é autorização de escopo.** As 10 telas em
  `docs/design-references/` definem identidade visual, não o que entra em
  cada fase da V1 — ampliar escopo com algo visto nelas exige pedido
  explícito do usuário.
- **Nunca ler, mostrar, imprimir ou versionar** valores de `.env.local`,
  senhas, tokens ou qualquer segredo.
- **Não avançar de fase** sem aprovação explícita do usuário.
- Toda nova decisão técnica relevante deve ser registrada em
  `docs/DECISIONS.md`, não solta no código ou só na conversa.
