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

## Visão futura: autoconhecimento e dados sensíveis (fora do escopo da V1)

Registrado em 2026-08-19, a pedido do usuário — é uma **direção
arquitetural**, não uma funcionalidade a implementar agora.

**O que é:** no futuro, o Mente Livre poderá incorporar sistemas de
autoconhecimento e desenvolvimento humano — por exemplo, **Eneagrama**
(associar a pessoa a um perfil, ajudar a reconhecer padrões de
comportamento/emocionais e trabalhar movimentos de desenvolvimento) e
**Calibryum** (outro sistema de desenvolvimento, que trabalharia em
conjunto com o Mente Livre). **Nenhum dos dois pertence à V1.** Não criar
tabelas, campos genéricos ou estruturas especulativas para eles agora.

**Princípio de arquitetura a preservar desde já:** mesmo sem implementar
esses módulos, a V1 não deve tomar decisões que dificultem essa evolução
depois. Em especial, nunca misturar conceitualmente estas 5 categorias de
dado:

1. dados declarados diretamente pelo usuário;
2. resultados produzidos por instrumentos/questionários;
3. observações comportamentais;
4. inferências produzidas por IA;
5. recomendações produzidas pelo sistema.

Uma inferência da IA nunca deve ser guardada ou mostrada silenciosamente
como se fosse um fato objetivo sobre a pessoa. Quando esse tipo de recurso
for construído no futuro, a modelagem deverá permitir registrar origem,
contexto, data e nível de confiança de cada informação.

**Segurança e privacidade como requisito estrutural, desde a V1** (não só
quando os módulos futuros chegarem):

- princípio de menor privilégio;
- RLS rigoroso, com políticas explícitas por operação (não `FOR ALL`
  genérico) — ver [`docs/SECURITY.md`](docs/SECURITY.md) e
  [`docs/DECISIONS.md`](docs/DECISIONS.md);
- isolamento total de dados entre usuários;
- autenticação verificada no servidor, nunca só na tela;
- segredos só no servidor; nenhuma service role no frontend;
- minimização de dados — coletar só o necessário;
- não registrar conteúdo pessoal desnecessariamente em logs;
- exclusão de conta/dados de forma segura (feature ainda não construída,
  mas a modelagem não deve dificultar isso depois);
- possibilidade futura de exportação dos dados do usuário;
- política de retenção de dados;
- rastreabilidade adequada de operações administrativas sensíveis;
- preparação para uma revisão de segurança antes de qualquer lançamento
  público;
- preparação para adequação à LGPD.

**Regra para conteúdo gerado por IA sobre a pessoa:** qualquer conteúdo
futuro da IA sobre personalidade, comportamento ou padrões do usuário deve
ser tratado como **interpretação/inferência**, nunca automaticamente como
diagnóstico ou fato. Esse tipo de funcionalidade, quando vier, precisa de
critérios próprios de consentimento, transparência, privacidade e
validação antes de entrar em produção — não herda automaticamente as
regras de nenhuma outra parte do produto.

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

## Arquitetura técnica

A stack, o diagrama de arquitetura, a estrutura de pastas e o desenho
incremental do banco de dados (uma tabela por fase) moraram nesta seção até
esta reorganização — agora estão em
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), sem perda de conteúdo. Este
arquivo (`PROJECT_CONTEXT.md`) continua sendo a fonte do **estado atual**
do projeto (visão, fases, pendências), não dos detalhes técnicos de
implementação.

As decisões técnicas específicas, com data e motivo, estão em
[`docs/DECISIONS.md`](docs/DECISIONS.md) (inclui, por exemplo, tema sempre
claro, cérebro como imagem raster, RLS explícito por operação, e o status
pendente de `@supabase/ssr`). Os princípios e mecanismos de segurança (RLS,
privilégio mínimo, segredos, teste de isolamento) estão em
[`docs/SECURITY.md`](docs/SECURITY.md).

## Funcionalidades implementadas

- [x] Fase 0 — Planejamento (aprovado)
- [x] Fase 1 — Projeto base: estrutura, tokens de design, componentes
      fundamentais, Tela 1 (Boas-vindas)
- [x] Correção visual pós-Fase 1 — Tela 1 realinhada à identidade visual
      oficial (ver seção "Identidade visual oficial" acima).
- [x] Catalogação das 10 telas de referência oficiais em
      `docs/design-references/` (descrição em texto; arquivos de imagem
      ainda pendentes — ver Pendências).
- [x] Asset oficial da Tela 1 instalado — placeholder removido, cérebro
      recortado da referência oficial em uso (ver "Identidade visual
      oficial" acima).
- [ ] Fase 2 — Autenticação e banco
- [x] Fase 3 — Brain dump por texto
- [x] Fase 4 — Organização por IA (mínima)
- [x] Fase 5 — Priorização (mínima)
- [ ] Fase 6 — Planejamento do dia
- [ ] Fase 7 — Hoje + Foco + Conclusão
- [ ] Fase 8 — Resumo do dia
- [ ] Fase 9 — Voz
- [ ] Fase 10 — Polimento e produção

## Pendências / próximos passos

- Fase 2 (em andamento):
  - [x] conta Supabase criada; tabela `profiles` via migration com RLS
        explícito por operação (`supabase/migrations/0001_create_profiles.sql`).
  - [x] clientes `@supabase/ssr` (browser/servidor) e refresh de sessão
        via `src/proxy.ts`.
  - [x] tela de login (`/login`) e logout funcional, com usuários já
        existentes — redireciona para `/entrada` após login.
  - [x] proteção de rota privada: `/entrada` exige sessão válida,
        redirecionando para `/login` no servidor (`src/proxy.ts`) quando
        não há uma. Validado manualmente de ponta a ponta no navegador
        (login, sessão persistente após refresh, logout, credenciais
        inválidas com mensagem genérica, acesso direto sem sessão
        redirecionando corretamente).
  - [x] tela de cadastro (`/cadastro`): email/senha via `signUp()`, com
        link discreto a partir de `/login`. Perfil criado automaticamente
        pelo trigger `handle_new_user` já existente (nenhuma tabela ou
        migration nova). Redireciona para `/entrada` se a confirmação de
        e-mail estiver desligada no projeto, ou mostra mensagem para
        verificar o e-mail caso contrário — ver `docs/DECISIONS.md`.
  - [x] recuperação de senha: `/esqueci-senha` (envia link via
        `resetPasswordForEmail()`) → `/auth/callback?next=/redefinir-senha`
        (troca o code por sessão de recovery) → `/redefinir-senha` (rota
        protegida, exige sessão; `updateUser({ password })`) → sessão
        encerrada e redirecionamento para `/login` para logar com a senha
        nova. Ver `docs/DECISIONS.md`. Mensagem de `/esqueci-senha` sempre
        genérica, para não permitir enumerar contas.
  - [x] OAuth (Google, em `/login`): botão "Entrar com Google" chama
        `signInWithGoogle()` (`src/lib/supabase/actions.ts`), que usa
        `signInWithOAuth()` e redireciona para a tela de consentimento do
        Google. Reaproveita o `/auth/callback` já existente (sem
        alteração) — mesmo mecanismo do cadastro/recuperação de senha.
        Vinculação de identidade por e-mail é automática (comportamento
        padrão do Supabase, não configurável) — ver `docs/DECISIONS.md`.
        Só Google por enquanto; só em `/login`, não em `/cadastro`.
  - [x] MFA (TOTP, opcional): `/mfa/configurar` (enroll + QR code) e
        `/mfa/verificar` (challenge no login), link em `/entrada`. Gate de
        AAL2 centralizado em `src/proxy.ts` — `/entrada` e
        `/redefinir-senha` exigem AAL2 somente quando existe TOTP
        verificado; sem MFA, nenhuma tela nova aparece. Só 1 fator TOTP no
        MVP, sem botão de desligar, sem SMS, sem códigos de backup — perda
        do autenticador é recuperação administrativa nesta fase. Ver
        `docs/DECISIONS.md`.
- Fase 3 (concluída):
  - [x] tabela `brain_dumps` (`supabase/migrations/20260823171808_create_brain_dumps.sql`),
        RLS explícita por operação (SELECT/INSERT/UPDATE/DELETE, nenhuma
        `FOR ALL`), mesmo padrão de `profiles`. `source` fixo em `'text'`
        nesta fase (CHECK constraint, não enum — `'voice'` fica para a
        Fase 9). Limite de 10.000 code points aplicado tanto no servidor
        (`Array.from(rawText).length`) quanto no banco
        (`char_length(raw_text) <= 10000`).
  - [x] `/entrada` deixou de ser placeholder: `BrainDumpForm` (Client
        Component) captura o texto e chama `createBrainDump()`
        (`src/lib/supabase/actions.ts`). `user_id` vem só de
        `getClaims().claims.sub`, nunca do formulário; `source` é literal
        no servidor. Mensagens sempre genéricas em erro.
  - [x] Textarea controlado no `BrainDumpForm` — necessário porque o React
        reseta campos não-controlados de um `<form action={...}>` sempre
        que a action termina sem lançar exceção, mesmo em erro lógico
        nosso; controlar o valor preserva o texto digitado em qualquer
        falha e só limpa após sucesso real. Ver `docs/DECISIONS.md`.
  - [x] Testado manualmente: salvamento normal, texto vazio/só espaços,
        emoji/caracteres especiais, falha de rede (texto preservado,
        depois salvo com sucesso ao reconectar), ownership de gravação
        entre duas contas reais (cada `brain_dump` com o `user_id`
        correto).
  - **Limitação registrada, não é pendência a resolver agora:** a Fase 3
    não inclui leitura/histórico de `brain_dumps` na aplicação — só
    criação. Por isso, o isolamento de `SELECT` entre usuários não foi
    testado via interface (não existe tela para isso); a política de
    `SELECT` já existe no banco (mesmo padrão de defesa em profundidade
    das demais tabelas), mas seu teste de isolamento fica para quando uma
    tela de leitura existir. Nenhuma funcionalidade de leitura foi criada
    só para viabilizar esse teste.
- Fase 4 (concluída, mínima):
  - [x] tabela `items` (`supabase/migrations/20260823200438_create_items.sql`),
        RLS explícita por operação, mesmo padrão das demais tabelas.
        Relação 1 `brain_dump` → no máximo 1 `item` (`unique(brain_dump_id)`).
        Campos: `category`, `title`, `description` (opcional), `priority`
        (opcional), `needs_confirmation` (sempre `true` nesta fase).
  - [x] `organizeBrainDump()` (`src/lib/supabase/actions.ts`), chamada pelo
        `BrainDumpForm` logo após um brain dump salvo com sucesso — etapa
        independente do salvamento: falha na organização nunca desfaz nem
        compromete o brain dump já persistido, e mostra mensagem amigável
        genérica ("Não consegui organizar agora."), nunca detalhe técnico.
  - [x] Chamada à Anthropic (`claude-opus-5`, `fetch` direto, sem SDK) só no
        servidor; `ANTHROPIC_API_KEY` nunca chega ao navegador. Resposta da
        IA validada por completo (JSON bem formado, `category`/`priority`
        contra allow-lists fechadas, tamanhos máximos de `title`/
        `description`) antes de persistir ou exibir — nunca confia na
        resposta bruta.
  - [x] `user_id` de `items` vem só de `getClaims().claims.sub`, nunca do
        cliente.
  - [x] Testado manualmente de ponta a ponta: brain dump salvo → IA chamada
        → sugestão estruturada exibida em `/entrada` (categoria, título,
        descrição, prioridade) → item persistido no banco.
  - **Fora do escopo desta fase:** nenhuma tela nova, histórico/listagem de
    items, edição, confirmação/aceite pelo usuário (`needs_confirmation`
    fica `true` e sem UI para mudar isso ainda), priorização (Eisenhower),
    agenda/plano do dia.
- Fase 5 (concluída, mínima):
  - [x] Fluxo completo: FALAR → ORGANIZAR → PRIORIZAR, tudo na mesma
        chamada à Anthropic da Fase 4 (`callAnthropicToOrganize()`) —
        nenhuma segunda chamada de IA foi criada.
  - [x] `items.priority` reaproveitado como único dado de prioridade
        persistido (`alta`/`média`/`baixa`/`null`) — nenhuma coluna, tabela
        ou migration nova. A lógica da Matriz de Eisenhower existe só como
        critério interno do prompt da IA, nunca como estrutura do banco.
  - [x] `priority_reason` (motivo curto, até 160 code points) adicionado à
        resposta da IA e ao retorno de `organizeBrainDump()`, só para
        explicar a recomendação na interface — **nunca persistido** no
        banco (`insert` em `items` inalterado).
  - [x] Rótulos de apresentação no `BrainDumpForm`: `alta` → "Fazer
        primeiro", `média` → "Planejar", `baixa` → "Pode esperar", `null`
        (ou qualquer valor fora do esperado) → "Precisa de mais contexto".
        Conversão só de exibição, mesma `/entrada`, mesmo card.
  - [x] IA continua só recomendando — `needs_confirmation` continua sempre
        `true`, sem nenhum botão de confirmar/ajustar/aceitar nesta fase.
  - [x] Testado manualmente com 4 casos reais: prazo explícito → "Fazer
        primeiro"; pensamento vago ("café") → "Precisa de mais contexto",
        sem inventar prazo/urgência; importante sem urgência imediata →
        "Planejar"; sem prazo nem consequência → "Pode esperar".
  - **Fora do escopo desta fase:** planejamento do dia, agenda, Google
    Calendar, Time Blocking, notificações, automações, histórico/listagem
    de items, confirmação/aceite pelo usuário, ranking de vários items,
    qualquer tela nova.
- **Pendente do usuário:** os outros 9 arquivos de imagem das telas de
  referência (para arquivar em `docs/design-references/` com os nomes já
  reservados no catálogo — a tela 01 já está resolvida). Confirmar também
  se há mesmo uma 11ª tela que não chegou a ser enviada.
