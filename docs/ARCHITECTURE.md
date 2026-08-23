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
  Clientes instalados: `@supabase/supabase-js` e `@supabase/ssr`.
  Autenticação server-side via `@supabase/ssr` **implementada**: login,
  logout, cadastro, recuperação de senha, OAuth (Google) e MFA (TOTP
  opcional) — ver `DECISIONS.md`.
- **Anthropic (Claude API)** (Fase 4, implementada) — organização por IA de
  um brain dump recém-salvo em sugestão estruturada (`items`), chamada só
  pelo backend via `fetch` direto (sem SDK).
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
    entrada/      Tela 2 — protegida por sessão; captura de brain dump por
                   texto (Fase 3, ver BrainDumpForm.tsx)
    login/        tela de login (email/senha)
    cadastro/     tela de cadastro (email/senha)
    esqueci-senha/  tela para solicitar link de redefinição de senha
    redefinir-senha/  tela para definir a nova senha (rota protegida)
    mfa/          configurar/verificar autenticação em duas etapas (TOTP)
    auth/callback/  Route Handler que troca o code (PKCE) por sessão
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
    supabase/     clientes @supabase/ssr (browser/servidor) e Server
                   Functions de auth (login, signup, logout)
public/
  brand/          assets de imagem da marca (cérebro/elemento principal)
supabase/
  config.toml     configuração da Supabase CLI (devDependency, ver DECISIONS.md)
  migrations/     migrations SQL do banco, aplicadas via Supabase CLI
                   (`npx supabase db push`)
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
- `brain_dumps` — **Fase 3, implementada.** id, user_id, raw_text, source
  (só `'text'` permitido nesta fase — `'voice'` fica para a Fase 9),
  created_at. Migration:
  [`supabase/migrations/20260823171808_create_brain_dumps.sql`](../supabase/migrations/20260823171808_create_brain_dumps.sql).
  Só criação (`INSERT`) é usada pela aplicação nesta fase — sem leitura,
  edição ou exclusão na UI ainda (ver `DECISIONS.md`).
- `items` — **Fase 4, implementada (mínima).** id, user_id, brain_dump_id
  (`unique`, no máximo 1 item por brain dump), category, title, description,
  priority, needs_confirmation (sempre `true` nesta fase), created_at.
  Migration:
  [`supabase/migrations/20260823200438_create_items.sql`](../supabase/migrations/20260823200438_create_items.sql).
  Schema reduzido ao necessário para a sugestão da IA — os campos do desenho
  original da Fase 0 (`type`, `estimated_minutes`, `due_date`, `due_time`,
  `status`, `notes`, `updated_at`) ficam para quando as fases que os usam
  (priorização, plano do dia) chegarem, mesmo princípio já aplicado a
  `brain_dumps`.
- `daily_plans` — **Fase 6.** id, user_id, plan_date, created_at,
  updated_at.
- `daily_plan_items` — **Fase 6.** id, plan_id, item_id, position,
  planned_start, planned_duration, completed_at, created_at, updated_at.

Todas, quando criadas, seguem o mesmo padrão: RLS ligado, políticas
explícitas por operação (ver [`DECISIONS.md`](./DECISIONS.md) e
[`SECURITY.md`](./SECURITY.md)).
