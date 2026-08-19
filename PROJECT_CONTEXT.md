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

Existem **10 telas de referência visual e de experiência oficiais** do
Mente Livre, enviadas pelo usuário em 2026-08-19 (o usuário mencionou 11;
apenas 10 imagens distintas chegaram até a IA — ver nota em
`docs/design-references/README.md`). Elas têm prioridade sobre qualquer
interpretação visual anterior e **devem ser consultadas em qualquer
implementação futura de tela**. O catálogo completo, com descrição de cada
tela e a linguagem visual comum extraída delas (cor, tipografia, sombras,
gradientes, botões, cards, ícones, hierarquia), está em
[`docs/design-references/README.md`](docs/design-references/README.md).

**Regra importante, pedida explicitamente pelo usuário:** referência visual
**não é autorização de escopo**. Várias das 10 telas mostram funcionalidades
fora do que foi aprovado na Fase 0 (Banco de Ideias, missão com cronômetro
e % de progresso, triagem de notificações externas, métrica de "clareza
mental %", Matriz Despertar Consciente). Essas ideias ficam registradas no
catálogo como possibilidade futura, mas **não entram na V1 automaticamente**
— o escopo aprovado na Fase 0 continua tendo prioridade. Qualquer decisão
de ampliar o escopo com algo visto nas referências precisa ser pedida
explicitamente pelo usuário.

A tela 01 do catálogo (`01-boas-vindas-capa.png`) corresponde à Tela 1 —
Boas-vindas do fluxo do produto.

**Cérebro/elemento abstrato principal — RESOLVIDO em 2026-08-19.** O
arquivo oficial da Tela 1 (composição completa da tela — cérebro, wordmark,
subtítulo e botão juntos, 853×1844) foi disponibilizado pelo usuário em
`docs/design-references/01-boas-vindas-capa.png` e permanece intacto ali
como referência (nunca editado). Como essa imagem é a composição inteira e
não só o cérebro isolado — e a Tela 1 já tem wordmark/subtítulo/botão como
componentes reais, que não deveriam ser duplicados —, foi recortado só o
elemento gráfico do cérebro dessa referência (usando `ffmpeg`, disponível
no ambiente), com uma borda de transparência gradual (~110px, via filtro
`geq`) nos quatro lados para a imagem se integrar ao fundo da interface sem
aparecer como um retângulo, e sem cortar a sombra do cérebro de forma
abrupta. O resultado (`public/brand/mente-livre-brain.png`, 760×940,
RGBA/com transparência) é o asset de produção usado por `BrainMark.tsx`
via `next/image`. Não existe mais placeholder nem aviso de "imagem
provisória" na interface.

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
docs/
  design-references/  catálogo das 10 telas de referência oficiais (texto
                       por ora — ver seção "Identidade visual oficial")
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
- **Asset de produção é um recorte com borda de transparência gradual**,
  não a imagem oficial "crua". Recortar sem essa borda deixava um retângulo
  visível (o branco da imagem não é pixel-idêntico ao fundo do app) e
  cortava a sombra do cérebro de forma abrupta. Se o usuário fornecer no
  futuro um asset já isolado do cérebro (fundo transparente, sem mockup de
  tela ao redor), ele pode substituir este recorte diretamente — não seria
  mais necessário reprocessar nada.
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
- [x] Catalogação das 10 telas de referência oficiais em
      `docs/design-references/` (descrição em texto; arquivos de imagem
      ainda pendentes — ver Pendências).
- [x] Asset oficial da Tela 1 instalado — placeholder removido, cérebro
      recortado da referência oficial em uso (ver "Identidade visual
      oficial" acima).
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
- **Pendente do usuário:** os outros 9 arquivos de imagem das telas de
  referência (para arquivar em `docs/design-references/` com os nomes já
  reservados no catálogo — a tela 01 já está resolvida). Confirmar também
  se há mesmo uma 11ª tela que não chegou a ser enviada.
