# Decisões técnicas — Mente Livre

Registro de decisões técnicas específicas, com motivo e (quando registrada
na origem) data. Este documento consolida o que já estava na seção
"Decisões arquiteturais registradas" de `PROJECT_CONTEXT.md`, sem alterar
seu conteúdo — apenas reorganizado em entradas individuais. **A partir de
agora, novas decisões técnicas devem ser adicionadas aqui**, não em
`PROJECT_CONTEXT.md` (que continua sendo o registro do estado/roadmap do
produto).

---

### Tema sempre claro

**Fase:** briefing inicial / Fase 1.
**Decisão:** o produto nunca fica escuro, mesmo com o sistema operacional
do usuário em modo escuro — por isso não há
`@media (prefers-color-scheme: dark)`.
**Motivo:** pedido explícito do briefing.

---

### Elemento visual principal (cérebro) é imagem raster, não SVG

**Data:** 2026-08-19.
**Decisão:** o cérebro é renderizado via `next/image` (raster), não como
SVG vetorial — decisão revertida a pedido do usuário.
**Motivo:** permitir fidelidade total ao asset 3D da identidade oficial; um
SVG vetorial nunca reproduziria a textura foto-realista da referência. O
Next.js otimiza formato/tamanho automaticamente ao servir a imagem.

---

### Asset de produção é um recorte com borda de transparência gradual

**Data:** 2026-08-19 (mesmo contexto da decisão anterior — ver
`PROJECT_CONTEXT.md`, seção "Identidade visual oficial").
**Decisão:** usar um recorte do cérebro com borda de transparência gradual
(~110px, filtro `geq` do ffmpeg), em vez da imagem oficial "crua".
**Motivo:** recortar sem essa borda deixava um retângulo visível (o branco
da imagem não é pixel-idêntico ao fundo do app) e cortava a sombra do
cérebro de forma abrupta.
**Nota:** se o usuário fornecer no futuro um asset já isolado do cérebro
(fundo transparente, sem mockup de tela ao redor), ele pode substituir este
recorte diretamente, sem reprocessar nada.

---

### Logomarca pequena continua sendo SVG

**Fase:** Fase 1.
**Decisão:** `LogoMark.tsx` permanece SVG (não segue a decisão acima sobre
o cérebro).
**Motivo:** é um traço simples — a observação sobre fidelidade fotorrealista
não se aplica a ela.

---

### Token `--shadow-glow` adicionado ao design system

**Fase:** Fase 1.
**Decisão:** token `--shadow-glow` adicionado em `globals.css` para o halo
azul difuso atrás de elementos circulares.
**Motivo:** visto em várias telas da referência oficial (orbe de IA, botão
de microfone). Ainda não está em uso na Tela 1 (o glow dela está embutido
no próprio asset do cérebro), mas o token já existe para as próximas telas
não reinventarem o efeito.

---

### `buttonVariants()` separado do elemento `<button>`

**Fase:** Fase 1.
**Decisão:** `Button.tsx` expõe `buttonVariants()` com as classes visuais
separadas do elemento `<button>`.
**Motivo:** permite estilizar um `<Link>` (que precisa continuar sendo um
`<a>` por acessibilidade/SEO) exatamente igual a um botão, sem duplicar
CSS.

---

### Sem biblioteca externa de classes condicionais

**Fase:** Fase 1.
**Decisão:** não usar `clsx`/`cva`; criado um `cn()` pequeno em
`src/lib/cn.ts`.
**Motivo:** evitar adicionar uma dependência externa por algo simples.

---

### Fase 2 cria só a tabela `profiles`, não as 5 tabelas do desenho da Fase 0

**Data:** 2026-08-19 (ajuste pedido pelo usuário).
**Decisão:** cada tabela do desenho original nasce na fase que efetivamente
vai usá-la, não todas de uma vez.
**Motivo:** não congelar cedo demais uma modelagem que pode mudar quando os
fluxos reais (brain dump, itens, plano do dia) forem construídos.

---

### RLS explícito por operação, nunca `FOR ALL` genérico

**Fase:** Fase 2.
**Decisão:** cada tabela tem uma política própria para SELECT, INSERT,
UPDATE e DELETE, com `USING`/`WITH CHECK` conforme o caso.
**Motivo:** pedido explícito do usuário, para que cada operação tenha sua
regra revisada individualmente, em vez de uma regra só "tampando" as
quatro. Ver [`SECURITY.md`](./SECURITY.md) para o padrão completo aplicado
em cada migration.

---

### Autenticação via `@supabase/ssr`

**Fase:** Fase 2.
**Decisão:** usar `@supabase/ssr` (pacote atual oficial da Supabase para
Next.js) para autenticação, não `auth-helpers-nextjs` (descontinuado) nem
sessão só em `localStorage`. Sessão em cookie httpOnly, renovada no
servidor.
**Status:** decisão registrada, **implementação ainda pendente** — hoje o
projeto só tem `@supabase/supabase-js` instalado; `@supabase/ssr`,
login/cadastro e middleware de proteção de rotas ficam para uma etapa
posterior da Fase 2 (ver `PROJECT_CONTEXT.md`, "Pendências / próximos
passos").
