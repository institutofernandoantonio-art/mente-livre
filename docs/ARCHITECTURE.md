# Arquitetura — Mente Livre

Este documento descreve **como o projeto é construído tecnicamente**: stack,
diagrama de alto nível, estrutura de pastas e o desenho do banco de dados.
Para visão de produto, status das fases e pendências, ver
[`PROJECT_CONTEXT.md`](../PROJECT_CONTEXT.md). Para o motivo de cada decisão
técnica específica, ver [`DECISIONS.md`](./DECISIONS.md). Para os mecanismos
de segurança, ver [`SECURITY.md`](./SECURITY.md).

## Stack escolhida

- **Next.js** (App Router, TypeScript) — frontend e backend no mesmo projeto.
- **Tailwind CSS v4** — estilos utilitários; tokens de design centralizados
  em `src/app/globals.css` (bloco `@theme inline`), não existe
  `tailwind.config.js` nessa versão.
- **Supabase** (Fase 2) — PostgreSQL gerenciado + autenticação + RLS (regra
  de segurança no próprio banco, impede um usuário ver dados de outro).
  Cliente atual instalado: `@supabase/supabase-js`. A autenticação
  server-side via `@supabase/ssr` está **decidida mas ainda não
  implementada** (ver `DECISIONS.md`) — é trabalho pendente da Fase 2, não
  desta tarefa.
- **Anthropic (Claude API)** (Fase 4) — organização por IA, chamada só pelo
  backend.
- **Vercel** (Fase 10) — deploy.

## Arquitetura

```
Navegador → páginas Next.js (React) → rotas de backend Next.js → Supabase / IA
```

O navegador nunca acessa banco ou IA diretamente — sempre pelas rotas de
backend, onde ficam as chaves secretas.

## Estrutura de pastas

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
    BrainMark.tsx elemento visual principal (imagem raster, ver
                   PROJECT_CONTEXT.md, seção "Identidade visual oficial")
    LogoMark.tsx  logomarca pequena (SVG, acima do wordmark)
  lib/
    cn.ts         utilitário para combinar classes CSS condicionalmente
public/
  brand/          assets de imagem da marca (cérebro/elemento principal)
supabase/
  migrations/     migrations SQL do banco (aplicadas manualmente no SQL
                   Editor do Supabase por enquanto — ver Pendências em
                   PROJECT_CONTEXT.md)
docs/
  design-references/  catálogo das 10 telas de referência oficiais
  ARCHITECTURE.md      este arquivo
  SECURITY.md           princípios e mecanismos de segurança
  DECISIONS.md          decisões técnicas individuais, com data e motivo
tests/
  security/
    rls.test.mjs  script de verificação manual de isolamento RLS (ver
                   SECURITY.md)
```

## Banco de dados

Desenho completo definido na Fase 0 (mantido como referência de onde o
produto vai chegar), mas **criado de forma incremental, uma tabela por
fase**, não tudo de uma vez:

- `profiles` — **Fase 2.** id, display_name, created_at, updated_at.
  Criada automaticamente (trigger) quando o usuário se cadastra. Migration:
  [`supabase/migrations/0001_create_profiles.sql`](../supabase/migrations/0001_create_profiles.sql).
- `brain_dumps` — **Fase 3.** id, user_id, raw_text, source (text/voice),
  created_at.
- `items` — **Fase 4.** id, user_id, brain_dump_id, title, original_text,
  type, priority, estimated_minutes, due_date, due_time, status,
  needs_confirmation, notes, created_at, updated_at.
- `daily_plans` — **Fase 6.** id, user_id, plan_date, created_at,
  updated_at.
- `daily_plan_items` — **Fase 6.** id, plan_id, item_id, position,
  planned_start, planned_duration, completed_at, created_at, updated_at.

Todas, quando criadas, seguem o mesmo padrão: RLS ligado, políticas
explícitas por operação (ver [`DECISIONS.md`](./DECISIONS.md) e
[`SECURITY.md`](./SECURITY.md)).
