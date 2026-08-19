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

## Identidade visual oficial

As imagens em `Desenho telas.pdf` / anexadas pelo usuário em 2026-08-19 são a
**referência visual oficial do Mente Livre V1** e têm prioridade sobre
qualquer interpretação visual anterior. Delas vieram os tokens de cor, o
padrão de sombra/glow, a tipografia do wordmark e o padrão de tela cheia
(elemento visual grande no topo, botão ancorado perto do rodapé com folga).

**Cérebro/elemento abstrato principal:** a referência usa uma imagem 3D
foto-realista (não um ícone vetorial). Não temos ferramenta de geração de
imagem raster disponível, então o asset atual em
`public/brand/mente-livre-brain.png` é um **placeholder provisório** (um
blob de gradiente azul simples, gerado programaticamente, sem tentar imitar
a forma do cérebro) — marcado como tal na própria tela (`BrainMark.tsx`
exporta `BRAIN_ASSET_IS_PLACEHOLDER`, que controla um aviso visível abaixo
da imagem). **Quando o arquivo oficial (PNG ou WebP, fundo transparente)
for fornecido:** substituir `public/brand/mente-livre-brain.png` por ele
(ou ajustar o caminho na constante `BRAIN_ASSET_SRC` em `BrainMark.tsx`) e
mudar `BRAIN_ASSET_IS_PLACEHOLDER` para `false`. Nenhuma outra parte da
tela precisa mudar — o componente já usa `next/image` com `object-contain`
e dimensionamento responsivo.

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
    BrainMark.tsx elemento visual principal (imagem raster, ver seção
                   "Identidade visual oficial" acima)
    LogoMark.tsx  logomarca pequena (SVG, acima do wordmark)
  lib/
    cn.ts         utilitário para combinar classes CSS condicionalmente
public/
  brand/          assets de imagem da marca (cérebro/elemento principal)
```

## Decisões arquiteturais registradas

- **Tema sempre claro.** O produto nunca deve ficar escuro, mesmo se o
  sistema operacional do usuário estiver no modo escuro (pedido explícito
  do briefing). Por isso não há `@media (prefers-color-scheme: dark)`.
- **Elemento visual principal (cérebro) é imagem raster via `next/image`**,
  não SVG — decisão revertida em 2026-08-19 a pedido do usuário, para
  permitir fidelidade total ao asset 3D da identidade oficial (um SVG
  vetorial nunca reproduziria a textura foto-realista da referência). O
  Next.js otimiza formato/tamanho automaticamente ao servir a imagem.
- **Logomarca pequena (`LogoMark.tsx`) continua sendo SVG** — é um traço
  simples, não faz parte da observação acima sobre o cérebro.
- **`--shadow-glow` foi adicionado aos tokens** (`globals.css`) para o halo
  azul difuso atrás de elementos circulares, visto em várias telas da
  referência oficial (orbe de IA, botão de microfone). Ainda não está em
  uso na Tela 1 — o glow dela está embutido no próprio asset do cérebro —
  mas o token já existe para as próximas telas não reinventarem o efeito.
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
- [x] Correção visual pós-Fase 1 — Tela 1 realinhada à identidade visual
      oficial (ver seção "Identidade visual oficial" acima). Cérebro
      permanece como placeholder até o asset oficial ser fornecido.
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
- **Pendente do usuário:** arquivo oficial do cérebro/elemento abstrato
  (PNG ou WebP, fundo transparente, alta resolução) para substituir o
  placeholder em `public/brand/mente-livre-brain.png` — ver seção
  "Identidade visual oficial".
