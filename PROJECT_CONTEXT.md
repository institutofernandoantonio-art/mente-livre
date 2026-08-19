# Contexto do projeto — Mente Livre

Este arquivo existe para que as decisões tomadas não sejam esquecidas ou
revertidas sem querer nas próximas fases. Deve ser atualizado ao final de
cada fase.

## Visão

App para pessoas com muitas coisas na cabeça. A pessoa despeja pensamentos
por texto ou voz; a IA organiza em tarefas, compromissos, ideias e
preocupações; o usuário revisa, prioriza e recebe um plano realista para o
dia. Dor principal: "tenho várias coisas na cabeça e não sei por onde
começar".

## Stack escolhida

- **Next.js** (App Router, TypeScript) — frontend e backend no mesmo projeto.
- **Tailwind CSS v4** — estilos utilitários; tokens de design centralizados
  em `src/app/globals.css` (bloco `@theme inline`), não existe
  `tailwind.config.js` nessa versão.
- **Supabase** (Fase 2) — PostgreSQL gerenciado + autenticação + RLS (regra
  de segurança no próprio banco, impede um usuário ver dados de outro).
- **Anthropic (Claude API)** (Fase 4) — organização por IA, chamada só pelo
  backend.
- **Vercel** (Fase 10) — deploy.

## Arquitetura

```
Navegador → páginas Next.js (React) → rotas de backend Next.js → Supabase / IA
```

O navegador nunca acessa banco ou IA diretamente — sempre pelas rotas de
backend, onde ficam as chaves secretas.

## Estrutura de pastas (até agora)

```
src/
  app/            páginas e rotas (App Router)
    page.tsx      Tela 1 — Boas-vindas
    entrada/      Tela 2 — placeholder até a Fase 3
    globals.css   tokens de design (cores, sombra) + estilos base
    layout.tsx    layout raiz, metadata, fontes
  components/
    ui/           componentes reutilizáveis (Button, Input, Textarea, Card,
                   Modal, Loader, EmptyState, ErrorState)
    BrainMark.tsx símbolo abstrato do Mente Livre (SVG)
  lib/
    cn.ts         utilitário para combinar classes CSS condicionalmente
```

## Decisões arquiteturais registradas

- **Tema sempre claro.** O produto nunca deve ficar escuro, mesmo se o
  sistema operacional do usuário estiver no modo escuro (pedido explícito
  do briefing). Por isso não há `@media (prefers-color-scheme: dark)`.
- **Símbolo do cérebro é SVG inline**, não imagem — fica leve e nítido em
  qualquer tela sem arquivo externo para carregar.
- **`buttonVariants()` em `Button.tsx`** expõe as classes visuais do botão
  separadas do elemento `<button>`, para poder estilizar um `<Link>` (que
  precisa continuar sendo um `<a>` por acessibilidade/SEO) exatamente igual
  a um botão, sem duplicar CSS.
- **Sem biblioteca de classes condicionais externa** (`clsx`/`cva`): criado
  um `cn()` bem pequeno em `src/lib/cn.ts` para não adicionar dependência
  por algo simples.

## Banco de dados (planejado para a Fase 2)

- `profiles` — id, display_name, created_at, updated_at
- `brain_dumps` — id, user_id, raw_text, source (text/voice), created_at
- `items` — id, user_id, brain_dump_id, title, original_text, type,
  priority, estimated_minutes, due_date, due_time, status,
  needs_confirmation, notes, created_at, updated_at
- `daily_plans` — id, user_id, plan_date, created_at, updated_at
- `daily_plan_items` — id, plan_id, item_id, position, planned_start,
  planned_duration, completed_at, created_at, updated_at

## Funcionalidades implementadas

- [x] Fase 0 — Planejamento (aprovado)
- [x] Fase 1 — Projeto base: estrutura, tokens de design, componentes
      fundamentais, Tela 1 (Boas-vindas)
- [ ] Fase 2 — Autenticação e banco
- [ ] Fase 3 — Brain dump por texto
- [ ] Fase 4 — Organização por IA
- [ ] Fase 5 — Priorização
- [ ] Fase 6 — Planejamento do dia
- [ ] Fase 7 — Hoje + Foco + Conclusão
- [ ] Fase 8 — Resumo do dia
- [ ] Fase 9 — Voz
- [ ] Fase 10 — Polimento e produção

## Pendências / próximos passos

- Fase 2: criar conta Supabase, definir tabelas acima com migrations, RLS,
  telas de cadastro/login/logout, proteção de rotas privadas.
