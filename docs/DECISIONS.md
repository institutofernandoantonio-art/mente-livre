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
sessão só em `localStorage`. Sessão gerenciada em cookies, com integração
browser/servidor via `@supabase/ssr` — os atributos exatos de cada cookie
(nome, `httpOnly`, `secure` etc.) são os que a própria implementação
oficial do pacote configura; não presumir nem documentar atributos
específicos aqui além do que ela define.
**Status (atualizado):** `@supabase/ssr@0.12.4` instalado. Clientes
`src/lib/supabase/client.ts` (browser) e `src/lib/supabase/server.ts`
(servidor) criados. `src/proxy.ts` criado — refresh de sessão por
requisição via `supabase.auth.getClaims()` (ver entrada própria abaixo,
"Refresh de sessão via `src/proxy.ts`"). Login e logout por email/senha
implementados (ver "Primeiro fluxo de login/logout" abaixo), com proteção
server-side de `/entrada` (ver "Proteção server-side de `/entrada`"
abaixo). Fluxo completo validado manualmente no navegador. Ainda faltam:
recuperação de senha, OAuth, MFA — cadastro e callback de confirmação já
implementados (ver entradas próprias abaixo).
**Nota técnica:** o Next.js 16 descontinuou `middleware.ts`, renomeado
para `proxy.ts` (mesma função, nome de arquivo/export diferente — ver
`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`).

---

### Refresh de sessão via `src/proxy.ts`

**Fase:** Fase 2.
**Decisão:** `src/proxy.ts` (convenção Next.js 16 — não `middleware.ts`)
roda em toda requisição (exceto assets estáticos, via `matcher`), cria um
cliente `@supabase/ssr` a partir dos cookies da requisição e chama
`await supabase.auth.getClaims()`, que valida o JWT no servidor e renova o
token quando necessário; o `setAll` do cliente grava os cookies atualizados
de volta na resposta.
**Motivo:** é o padrão exigido pelo próprio `@supabase/ssr` para que a
sessão continue válida entre requisições (ver `node_modules/@supabase/ssr/docs/design.md`,
seção "SSR framework patterns" — "Using the middleware pattern is
mandatory"). Preferido `getClaims()` a `getUser()`/`getSession()`: valida a
JWT (localmente via JWKS quando o projeto usa chaves assimétricas) em vez
de só ler o cookie sem verificação, e evita uma chamada de rede ao servidor
de Auth a cada requisição quando a verificação pode ser feita localmente.
**Proteção adicional:** o proxy recusa rodar se `NEXT_PUBLIC_SUPABASE_ANON_KEY`
parecer ser uma `service_role` key (mesmo padrão de guarda já usado em
`tests/security/rls.test.mjs`).

---

### Primeiro fluxo de login/logout (email/senha)

**Fase:** Fase 2.
**Decisão:** página de login na rota `/login` (Server Component com um
formulário Client Component, `src/app/login/LoginForm.tsx`, usando
`useActionState`). O login e o logout são Server Functions em
`src/lib/supabase/actions.ts` — colocadas junto dos clientes Supabase
(`client.ts`/`server.ts`) em vez de espalhadas por rota, já que são as
únicas mutações de auth do projeto até agora. Após login bem-sucedido,
redireciona para `/entrada` (rota já existente, hoje um placeholder da
Fase 3) em vez de criar uma tela nova ou dashboard — `/entrada` agora
também mostra a sessão ativa (email) e um botão "Sair" quando há uma
sessão, sem virar um dashboard. Erros de login sempre mostram a mesma
mensagem genérica ("Email ou senha inválidos.") — nunca revelam se foi o
e-mail ou a senha que estava errada, nem qualquer detalhe da resposta do
Supabase.
**Motivo:** `/login` é o nome já usado nas pendências registradas em
`PROJECT_CONTEXT.md` ("telas de cadastro/login/logout"); reaproveitar
`/entrada` evita construir uma tela nova só para "provar" que a sessão
funciona, mantendo o escopo desta etapa mínimo; a mensagem de erro genérica
segue o princípio de minimização de informação já registrado em
`docs/SECURITY.md` — revelar qual campo está errado ajuda um atacante a
enumerar contas cadastradas.
**Validado manualmente no navegador:** login com usuário de teste
(`teste1@mentelivre.local`), sessão persistente após refresh da página,
logout, e credenciais inválidas mostrando só a mensagem genérica.
**Pendente:** OAuth, MFA.

---

### Cadastro por email/senha (`/cadastro`)

**Fase:** Fase 2.
**Decisão:** página `/cadastro` no mesmo padrão estrutural do login
(Server Component + `SignupForm.tsx` Client Component com
`useActionState`). A Server Function `signup` (em
`src/lib/supabase/actions.ts`, junto de `login`/`logout`) chama
`supabase.auth.signUp({ email, password })` usando o cliente de servidor
já existente — nenhum cliente novo. `/login` ganhou um link discreto
"Criar conta" apontando para `/cadastro`.
**Detecção dinâmica da confirmação de e-mail:** em vez de presumir se o
projeto exige confirmação de e-mail (informação que não foi verificada no
painel do Supabase durante o planejamento), `signup` decide pelo próprio
retorno de `signUp()`: se `data.session` existir, a sessão já está ativa
(confirmação desligada) e redireciona para `/entrada`, igual ao login; se
`data.session` for `null` (confirmação ligada), fica em `/cadastro`
mostrando "Conta criada. Verifique seu email para confirmar antes de
entrar.", sem sessão nenhuma.
**Criação de `public.profiles`:** reaproveita o trigger `handle_new_user`
já existente (`supabase/migrations/0001_create_profiles.sql`), que dispara
em `after insert on auth.users` independentemente de a sessão ser criada
imediatamente ou não. Nenhuma tabela, trigger ou migration nova.
**Mensagem de erro:** uma única mensagem genérica para qualquer falha do
`signUp()` ("Não foi possível criar a conta com esses dados. Verifique o
email e a senha e tente novamente.") — mesmo princípio já aplicado no
login (ver `docs/SECURITY.md`): nunca diferenciar email já cadastrado de
senha fraca, para não permitir enumerar contas.
**Motivo:** manter o mesmo padrão estrutural e de segurança já validado no
login/logout, sem introduzir uma segunda abordagem; a detecção dinâmica
evita presumir uma configuração do Supabase que não foi confirmada.

---

### Callback de confirmação de e-mail (`/auth/callback`)

**Fase:** Fase 2.
**Problema encontrado em teste manual:** `@supabase/ssr` usa o fluxo PKCE
por padrão. Sem `emailRedirectTo`, o link do e-mail de confirmação voltava
para a Site URL do projeto (a raiz `/`) com `?code=...` na query string, e
nada no app consumia esse código — o usuário confirmava o e-mail mas caía
na tela de boas-vindas sem sessão nenhuma, precisando logar manualmente
depois em `/login`.
**Decisão:** nova rota `src/app/auth/callback/route.ts` (Route Handler,
não Server Component) que lê `code` da URL e chama
`supabase.auth.exchangeCodeForSession(code)` usando o mesmo `createClient()`
de `src/lib/supabase/server.ts`, sem alteração nele. Sucesso redireciona
para `/entrada`; ausência de `code` ou qualquer erro na troca (expirado,
já usado, inválido) redireciona para `/login`, sem parâmetro de erro na
URL nem log do motivo — mesmo princípio de mensagem genérica já usado em
`login`/`signup`. `signup()` passou a chamar `signUp()` com
`options: { emailRedirectTo }`, onde `emailRedirectTo` é montado a partir
do header `origin` da própria requisição (via `headers()` de
`next/headers`), sem variável de ambiente nova.
**Por que Route Handler e não Server Component:** trocar o código por
sessão exige *escrever* cookies, e `cookies().set()` só é permitido em
Route Handlers e Server Actions no Next.js App Router — não durante a
renderização de um Server Component (é exatamente por isso que
`src/lib/supabase/server.ts` engole esse erro em silêncio num `try/catch`
já existente).
**Configuração fora do repositório:** o painel do Supabase
(Authentication → URL Configuration → Redirect URLs) precisa incluir a URL
de callback (`<site-url>/auth/callback`) na allow-list, senão o Supabase
rejeita o `emailRedirectTo`. Isso não é versionável no repo.
**Fora do escopo:** nenhuma mensagem de erro específica em `/login` para
link expirado/inválido/já usado — mantém o padrão genérico já adotado.

---

### Proteção server-side de `/entrada`

**Fase:** Fase 2.
**Decisão:** a checagem de acesso mora em `src/proxy.ts`, reaproveitando o
`getClaims()` que já roda ali para o refresh de sessão — sem criar um
segundo cliente Supabase nem uma segunda validação. Se
`request.nextUrl.pathname` for uma das rotas protegidas (`/entrada` e,
desde a recuperação de senha, também `/redefinir-senha` — ver entrada
própria abaixo) e não houver sessão válida (`data` nulo), o proxy responde
com `NextResponse.redirect('/login')` em
vez de deixar a requisição prosseguir, copiando para a resposta de
redirecionamento os cookies que o `setAll` já tivesse gravado (caso um
refresh de token tenha falhado e precisado limpar um cookie inválido).
Nenhuma outra rota foi afetada; `/entrada` continua com sua própria
chamada a `getClaims()` em `src/app/entrada/page.tsx`, necessária para
exibir o email da sessão — chamada separada por ser um contexto de
execução diferente (render da página vs. proxy), não duplicação evitável.
**Motivo:** validar acesso no servidor, antes de qualquer renderização,
para não depender de nenhuma checagem no navegador (`não confiar apenas no
frontend`); reaproveitar a mesma chamada de `getClaims()` já existente
evita duplicar cliente/validação por rota.
**Validado manualmente no navegador:** acesso direto a `/entrada` sem
sessão redireciona para `/login`; com sessão, abre normalmente.

---

### Recuperação de senha (`/esqueci-senha` → `/redefinir-senha`)

**Fase:** Fase 2.
**Decisão:** dois passos, reaproveitando toda a infraestrutura já existente
— nenhum cliente Supabase novo, nenhuma variável de ambiente nova.

1. `/esqueci-senha` (Server Component + `ForgotPasswordForm.tsx` Client
   Component, mesmo padrão de `/cadastro`) chama a nova Server Function
   `requestPasswordReset` (`src/lib/supabase/actions.ts`), que executa
   `supabase.auth.resetPasswordForEmail(email, { redirectTo:
   '${origin}/auth/callback?next=/redefinir-senha' })` — `origin` vem do
   header da própria requisição, mesmo padrão já usado em `signup()`.
2. O link do e-mail cai em `/auth/callback`, que agora aceita um parâmetro
   `next` opcional, validado contra uma **allow-list fechada**
   (`ALLOWED_NEXT_PATHS = new Set(['/entrada', '/redefinir-senha'])`) —
   `next` nunca é usado como redirect direto, só escolhe entre esses dois
   caminhos fixos; qualquer outro valor cai no default `/entrada`. Sem
   `next` (caso do `signup()`), o comportamento é idêntico ao de antes.
   `/redefinir-senha` foi adicionada à proteção de rota em `src/proxy.ts`
   (mesmo `getClaims()` já reaproveitado por `/entrada` — ver entrada
   acima), então só é alcançável com a sessão de recovery que o callback
   acabou de criar.
3. `/redefinir-senha` (Server Component + `ResetPasswordForm.tsx`) chama a
   nova Server Function `updatePassword`, que executa
   `supabase.auth.updateUser({ password })` e, em caso de sucesso, chama
   `supabase.auth.signOut()` e redireciona para `/login` — o usuário
   precisa logar de novo com a senha nova, em vez de continuar
   automaticamente autenticado com a sessão que o link de e-mail abriu.
**Motivo do signOut() em vez de ir direto para `/entrada`:** a sessão criada
por `exchangeCodeForSession()` ao clicar o link é uma sessão completa, não
limitada a "só trocar senha" — sem o `signOut()`, bastaria clicar o link do
e-mail (sem nunca definir senha nova) para ganhar uma sessão válida no app.
Encerrar a sessão e exigir login de novo reduz essa janela.
**Mensagens genéricas:** `/esqueci-senha` sempre responde com a mesma
mensagem de sucesso, exista ou não o e-mail informado —
`resetPasswordForEmail()` já não revela isso, e a Server Function nunca
diferencia por erro. `code` ausente/inválido/expirado/já usado em
`/auth/callback` continua caindo em `/login` sem detalhe, como antes.
**Assinaturas confirmadas nos tipos reais do pacote instalado** (não
presumidas): `resetPasswordForEmail(email: string, options?: { redirectTo?:
string; captchaToken?: string })` e `updateUser(attributes: UserAttributes,
options?)` aceitando `{ password: string }`, ambas em
`node_modules/@supabase/auth-js/dist/module/GoTrueClient.d.ts`
(`@supabase/supabase-js@2.112.3`).
**Configuração fora do repositório:** a doc do próprio
`resetPasswordForEmail()` recomenda consultar "redirect URLs and
wildcards" no painel do Supabase. A Redirect URL
`<site-url>/auth/callback?next=/redefinir-senha` foi cadastrada como
entrada própria na allow-list (além de `<site-url>/auth/callback`, já
existente para o cadastro).
**Validado manualmente no navegador, de ponta a ponta:** solicitação em
`/esqueci-senha` → e-mail recebido → `/auth/callback` → `/redefinir-senha`
→ nova senha salva → `signOut()` → `/login` → login com a senha nova →
`/entrada` autenticada.
**Limitação operacional observada, não é falha do fluxo:** o serviço de
e-mail embutido do Supabase tem limite fixo de 2 e-mails/hora; tentativas
repetidas durante os testes retornaram HTTP 429. Isso é uma restrição do
ambiente (esperado ser substituído por um provedor de e-mail próprio antes
de produção), não um defeito no código deste fluxo.
**Fora do escopo:** OAuth, MFA, captcha e qualquer item da Fase 3.

---

### Login social com Google (`signInWithGoogle()`)

**Fase:** Fase 2.
**Decisão:** só em `/login` (não em `/cadastro` — OAuth já unifica login e
cadastro num único clique, um segundo botão lá seria redundante nesta
etapa). Nova Server Function `signInWithGoogle()`
(`src/lib/supabase/actions.ts`), sem parâmetros, chamada via
`<form action={signInWithGoogle}>` em `src/app/login/page.tsx` — mesmo
padrão de `logout()` (sem `useActionState`, já que não há estado útil para
mostrar antes do redirect externo). Usa o `createClient()` de
`src/lib/supabase/server.ts` já existente, sem cliente novo:
```ts
const { data, error } = await supabase.auth.signInWithOAuth({
  provider: 'google',
  options: { redirectTo: `${origin}/auth/callback` },
});
```
`origin` vem do header da própria requisição (`headers()`), mesmo padrão
de `signup()`/`requestPasswordReset()`. Erro ou `data.url` ausente
redireciona para `/login` sem detalhe — mesmo princípio de mensagem
genérica já usado nas demais Server Functions deste arquivo.
**Por que Server Action, não Client Component:** confirmado lendo a
implementação real (`node_modules/@supabase/auth-js/dist/module/GoTrueClient.js`,
`_handleProviderSignIn`) — `window.location.assign(url)` só roda se
`isBrowser()` for verdadeiro; no servidor essa linha é pulada e a função
só devolve `{ data: { url }, error }`, sem efeito colateral. Isso permite
chamar `signInWithOAuth()` no servidor com segurança e nós mesmos
chamarmos `redirect(data.url)`. Mais importante: nosso cliente roda em
`flowType: 'pkce'` com o verificador PKCE guardado em **cookies**
(`createServerClient`); se o fluxo iniciasse no navegador com
`createBrowserClient`, o verificador iria para `localStorage`, e o
`/auth/callback` (que só lê cookies) não o encontraria — a mesma classe de
falha diagnosticada na recuperação de senha.
**`/auth/callback` reaproveitado sem nenhuma alteração:** `redirectTo` não
leva `?next=`, então cai no default já existente (`/entrada`) — o mesmo
caminho de código que já processa a confirmação de cadastro. Cancelamento
do usuário na tela do Google (ou erro do provider) faz o GoTrue redirecionar
de volta sem `code`, o que já cai no `redirect('/login')` genérico
existente — sem necessidade de tratar esse caso separadamente.
**Vinculação de identidade por e-mail:** comportamento padrão do Supabase
Auth, sempre ativo, **não é uma opção configurável** (confirmado na
documentação oficial, não presumido) — identidades com o mesmo e-mail são
vinculadas automaticamente ao mesmo usuário (`auth.users.id`), nunca criam
conta duplicada nem uma segunda linha em `public.profiles` (o `on conflict
(id) do nothing` do trigger `handle_new_user` já cobre isso). Por
segurança, o Supabase remove identidades não confirmadas de um usuário
existente quando uma nova identidade correspondente é vinculada — evita
sequestro de conta via e-mail não confirmado ("Confirm email" já está
ligado neste projeto).
**Configuração externa (fora do repositório):** Google Cloud (cliente
OAuth Web, Redirect URI `https://oinotyonxiiekuouvhdc.supabase.co/auth/v1/callback`)
e Supabase Dashboard (Authentication → Providers → Google habilitado,
Client ID/Secret configurados, "Skip nonce checks" desligado, "Allow users
without an email" desligado) — já concluída pelo usuário antes desta
implementação.
**Validado manualmente no navegador:** login com Google, retorno pelo
callback, sessão criada, acesso a `/entrada`, logout, novo login com
Google, e login com uma segunda conta Google — todos funcionando.
**Pendente de teste, não bloqueia:** o cancelamento do usuário na tela de
consentimento do Google ainda não foi reproduzido manualmente — nas
tentativas feitas, o Google reaproveitou a autorização já concedida e
autenticou direto, sem oferecer a tela de cancelar. O código já trata esse
caso (qualquer retorno sem `code` cai no `redirect('/login')` genérico,
igual a qualquer outra falha), mas o comportamento específico do
cancelamento continua sem confirmação end-to-end.
**Fora do escopo:** outros provedores OAuth, MFA, captcha, Fase 3.

---

### MFA — TOTP opcional (`/mfa/configurar`, `/mfa/verificar`)

**Fase:** Fase 2.
**Decisão de produto:** MFA é opcional (opt-in), só TOTP (sem SMS), no
máximo 1 fator TOTP verificado por usuário no MVP, sem botão de desligar
MFA nesta primeira implementação, sem códigos de backup próprios. Perda do
autenticador é tratada como recuperação administrativa (remoção manual do
fator pelo Supabase Dashboard → Authentication → Users), não uma feature
de auto-recuperação.

**Fonte do AAL atual vs. fonte da existência de fator — resolvido lendo o
código real, não por preferência:** `getClaims().data.claims.aal` é a
única fonte usada para "qual é o nível atual da sessão" (JWT verificado
criptograficamente, mesmo padrão já em uso). Para "a conta tem um TOTP
verificado", usamos `mfa.listFactors()` — que sempre chama `getUser()` no
servidor (`GoTrueClient.js:4980-4998`), nunca confiando em
`session.user.factors` obtido só de `getSession()` (que só lê o cookie,
sem verificar nada — e nossos cookies não são `httpOnly`, então esse
campo seria editável pelo próprio usuário). O caminho **sem** `jwt` de
`getAuthenticatorAssuranceLevel()` foi descartado por essa mesma razão:
ele usa `getSession()` internamente (`GoTrueClient.js:5036-5057`).

**Proteção no `src/proxy.ts` (única mudança no proxy):**
- `SESSION_REQUIRED_PATHS` (`/mfa/configurar`, `/mfa/verificar`): exigem
  só sessão válida (AAL1 basta) — `/mfa/verificar` não pode exigir AAL2
  de si mesma, senão uma sessão pendente de segundo fator nunca
  conseguiria alcançar a própria tela de verificação.
- `AAL2_REQUIRED_PATHS` (`/entrada`, `/redefinir-senha`): quando a sessão
  não está em `aal2`, chama `listFactors()`; se houver TOTP verificado,
  redireciona para `/mfa/verificar?next=<pathname>` (o `next` é sempre um
  dos dois valores deste próprio Set — nunca um valor arbitrário). Sem
  fator verificado, deixa passar em AAL1 — zero impacto para quem não usa
  MFA.
- **`/redefinir-senha` exige AAL2** pelo mesmo motivo de `/entrada`: sem
  isso, quem só tivesse acesso ao e-mail de recuperação (não ao
  autenticador) conseguiria trocar a senha de uma conta com MFA — um
  desvio completo da segunda camada.
- **Fail-closed explícito:** se `listFactors()` retornar erro, o proxy
  **nunca** deixa passar — redireciona para `/login` (rota sem checagem
  de AAL2, então sem risco de loop). Decisão explícita: sem log novo
  nesta etapa (nem temporário, nem permanente).

**`next` do `/mfa/verificar`, allow-list fechada:** o mesmo
`Set(['/entrada', '/redefinir-senha'])` é revalidado em três lugares
independentes — `src/proxy.ts` (quem gera o redirect), o Server Component
de `/mfa/verificar` (antes de renderizar o formulário) e
`verifyMfaChallenge()` (antes do redirect final) — nenhum deles confia
que o valor já foi validado em outro lugar.

**Limite de 1 TOTP verificado, aplicado no servidor:** `enrollMfaFactor()`
chama `listFactors()` antes de tudo; se `factors.totp.length > 0` (já tem
um fator verificado), recusa e não chama `enroll()`. Também limpa
tentativas de enrollment anteriores abandonadas (`factors.all` filtrado
por `factor_type === 'totp' && status === 'unverified'`) chamando
`unenroll()` sobre elas antes de criar uma nova — evita acumular fatores
não verificados inúteis. **Isso não implementa a funcionalidade de
desligar MFA:** `unenroll()` só é chamado sobre fatores que o próprio
usuário nunca confirmou; nunca sobre um fator `verified`. A exigência de
AAL2 documentada para `unenroll()` (`types.d.ts:1279-1282`) é
especificamente para fator *verified* — confirmado lendo a implementação
real de `_unenroll()` (`GoTrueClient.js:4816-4836`), que não tem nenhuma
checagem de AAL do lado do cliente; a exigência é aplicada só pelo
servidor do GoTrue, e só nesse caso.

**QR code:** `enroll({ factorType: 'totp' })` devolve `data.totp.qr_code`
como conteúdo SVG cru — não uma data URI pronta. Precisa do prefixo
`data:image/svg+xml;utf-8,` antes de usar em `<img src>`
(`types.d.ts:1626-1640`, comentário do próprio tipo). Nenhuma biblioteca
de QR code foi adicionada.

**Fluxo de enrollment:** `/mfa/configurar` (link em `/entrada`) →
`EnrollMfaForm.tsx` (único Client Component do app com estado em duas
etapas — precisa guardar `{ factorId, qrCode, secret }` entre a chamada
de `enroll()` e a de confirmação) → `enrollMfaFactor()` devolve o QR code
→ usuário digita o primeiro código → `confirmMfaEnrollment(factorId, ...)`
→ `mfa.challengeAndVerify()` → sessão promovida a `aal2` automaticamente
(o `createServerClient` do `@supabase/ssr` já trata o evento
`MFA_CHALLENGE_VERIFIED` para persistir isso em cookie, sem mudança em
`server.ts`) → `redirect('/entrada')`.

**Fluxo de challenge no login:** `login()`, `signup()` e
`signInWithGoogle()` continuam **inalterados** — todos terminam em
`redirect('/entrada')` como sempre. É o `proxy.ts`, ao processar a
requisição seguinte, que decide se deixa passar ou manda para
`/mfa/verificar`. Isso vale igualmente para login por senha e por Google
— nenhum dos dois precisa saber que MFA existe.

**Não alterados, confirmado neste desenho:** `src/lib/supabase/server.ts`,
`src/lib/supabase/client.ts`, `src/app/auth/callback/route.ts`, `login()`,
`signup()`, `signInWithGoogle()`.
**Fora do escopo:** desligar MFA, múltiplos fatores, SMS, códigos de
backup próprios, Fase 3.

---

### Brain dump por texto (Fase 3)

**Decisão:** `brain_dumps` (id, user_id, raw_text, source, created_at),
RLS explícita por operação (SELECT/INSERT/UPDATE/DELETE, nunca `FOR ALL`),
mesmo padrão de `profiles`. Aplicada via Supabase CLI (adotada nesta
etapa como devDependency — ver entrada própria abaixo), não mais colada
manualmente no SQL Editor.
**Ownership:** `user_id` só de `getClaims().claims.sub` na Server Function
`createBrainDump()` (`src/lib/supabase/actions.ts`) — nunca do formulário.
Reforçado por `WITH CHECK (auth.uid() = user_id)` na política de INSERT
(defesa em profundidade, mesmo princípio já usado em todas as tabelas
deste projeto).
**`source` fixo em `'text'` nesta fase:** literal no servidor, nunca lido
do formulário. `CHECK (source in ('text'))` no banco, não `ENUM` do
Postgres — ampliar um `ENUM` depois tem restrições transacionais; um
`CHECK` é trivial de trocar quando a Fase 9 (voz) chegar.
**Limite de 10.000 caracteres, mesma semântica em servidor e banco:**
`Array.from(rawText).length` no TypeScript, `char_length(raw_text)` no
Postgres — os dois contam por *code point* Unicode. `rawText.length` (JS)
foi descartado de propósito: conta unidades UTF-16, divergindo do banco
para emoji fora do BMP (confirmado empiricamente durante o planejamento).
**Somente criação nesta fase:** a aplicação só faz `INSERT` em
`brain_dumps` — nenhuma leitura, edição ou exclusão na UI. As políticas de
SELECT/UPDATE/DELETE já existem no banco (mesmo padrão de proteção
completa desde já, independente do que a UI usa hoje), mas seu teste de
isolamento entre usuários fica pendente de uma tela de leitura futura —
nenhuma tela foi criada só para viabilizar esse teste agora.
**Bug de UX corrigido durante o teste manual — textarea perdia o texto em
qualquer erro:** o React reseta campos não-controlados de um `<form
action={...}>` sempre que a *action* termina sem lançar exceção — e
`createBrainDump()` nunca lança, só retorna `{ error, success: false }`
em qualquer falha. Para o React isso conta como "sucesso da action",
então o campo era limpo mesmo em erro lógico nosso (confirmado na
documentação oficial do React, não presumido). Correção: `Textarea` do
`BrainDumpForm` passou a ser controlado (`value`/`onChange` locais); a
limpeza no sucesso passou a ser feita durante a renderização (comparando
a referência do `state` do `useActionState` com a do último processado),
não dentro de `useEffect`, para não disparar `setState` síncrono em
efeito (apontado pelo lint `react-hooks/set-state-in-effect`).
**Testado manualmente:** salvamento normal, texto vazio/só espaços,
emoji/caracteres especiais, falha de rede (texto preservado, depois
salvo com sucesso ao reconectar), ownership de gravação entre duas
contas reais — cada `brain_dump` associado ao `user_id` correto,
confirmado diretamente na tabela.
**Fora do escopo:** IA, histórico/listagem, edição, exclusão na UI,
priorização, items, daily plans, voz — qualquer coisa de Fase 4 em
diante.

---

### Organização de um brain dump por IA (Fase 4 mínima)

**Decisão:** `items` (id, user_id, brain_dump_id, category, title,
description, priority, needs_confirmation, created_at), RLS explícita por
operação, mesmo padrão das demais tabelas. `brain_dump_id` é `unique` —
no máximo 1 item por brain dump nesta fase (repetir a organização do mesmo
brain dump é tratado como qualquer outra falha, sem duplicar).
**Independência entre salvar e organizar:** `createBrainDump()` (Fase 3,
inalterada) persiste o brain dump primeiro; `organizeBrainDump()` é chamada
depois, separadamente, pelo `BrainDumpForm` (Client Component), assim que o
`useActionState` confirma sucesso com um `brainDumpId`. Se a organização
falhar por qualquer motivo, o brain dump já salvo não é desfeito nem
afetado — a interface mostra "Pensamento salvo. Não consegui organizar
agora.", nunca um erro técnico.
**Chamada à Anthropic:** `fetch` direto para
`https://api.anthropic.com/v1/messages` (sem SDK, decisão explícita do
usuário), só no servidor (`callAnthropicToOrganize()`, função interna de
`src/lib/supabase/actions.ts`) — `ANTHROPIC_API_KEY` nunca chega ao
navegador. Modelo `claude-opus-5`, `max_tokens: 500`,
`output_config: { effort: 'low' }`. Qualquer falha (chave ausente, rede,
HTTP não-2xx, JSON inválido, resposta sem bloco de texto) retorna `null` em
silêncio — sem propagar detalhe técnico da Anthropic para o usuário.
**Validação defensiva da resposta:** `parseOrganizedItem()` nunca confia no
texto devolvido pela IA — faz `JSON.parse` em try/catch, valida `category`
e `priority` contra allow-lists fechadas (`Set`), valida `title`
(obrigatório, não-vazio, ≤200 code points) e `description` (opcional,
≤500 code points), usando `Array.from(str).length` (code points), mesmo
critério já usado em `brain_dumps`. Qualquer campo fora do esperado
descarta a sugestão inteira (`null`), nunca persiste parcialmente.
**`needs_confirmation` sempre `true`:** a IA só recomenda — nenhuma
sugestão é tratada como confirmada automaticamente. Não existe ainda
nenhuma UI para o usuário confirmar/editar/rejeitar; isso fica para uma
fase futura.
**`user_id` de `items`:** só de `getClaims().claims.sub` dentro de
`organizeBrainDump()`, nunca do cliente — mesmo padrão já usado em
`createBrainDump()`.
**Padrão de estado reaproveitado do bug da Fase 3:** a transição de
`organizeStatus` (`idle` → `organizing` → `done`/`failed`) no
`BrainDumpForm` segue o mesmo padrão já usado para o `rawText` — ajuste
durante a renderização (comparando a referência do `state` do
`useActionState`) para disparar a transição para `organizing`, e o
`useEffect` só faz a chamada assíncrona em si, atualizando o estado dentro
do `.then()` — nunca `setState` síncrono no corpo do efeito (mesmo motivo
do lint `react-hooks/set-state-in-effect` já documentado na entrada do
brain dump).
**Diagnóstico de uma falha real durante o teste manual:** a organização
retornou `null` em dois testes reais consecutivos por dois motivos
distintos, ambos fora do código da aplicação — (1) a chave configurada
inicialmente não tinha crédito na conta/workspace Anthropic (erro HTTP,
não bug de request); (2) após trocar a chave, um `400 invalid_request_error`
momentâneo. Diagnosticado com instrumentação temporária (`console.error`
marcado `[TEMP-ANTHROPIC-DIAGNOSTIC]`, só com metadados não-sensíveis:
status HTTP, tipo/mensagem de erro da Anthropic, `stop_reason`,
presença/tamanho do bloco de texto — nunca a chave, o texto do usuário, o
prompt ou a resposta da IA) — removida por completo depois do diagnóstico
confirmado; não sobrou nenhum log temporário no código.
**Testado manualmente, de ponta a ponta:** brain dump salvo → IA chamada →
sugestão estruturada exibida em `/entrada` (categoria, título, descrição,
prioridade) → item persistido (confirmado via
`supabase inspect db table-stats --linked`, somente leitura).
**Fora do escopo:** histórico/listagem de items, edição, confirmação/aceite
pelo usuário, priorização (Eisenhower), agenda/plano do dia, nenhuma tela
nova.

---

### Priorização mínima reaproveitando a chamada da Fase 4 (Fase 5)

**Decisão:** completar o fluxo FALAR → ORGANIZAR → PRIORIZAR sem nenhuma
migration, tabela, coluna, rota ou Server Action nova, e sem uma segunda
chamada à Anthropic — a mesma chamada de `callAnthropicToOrganize()` (Fase
4) passou a devolver também a recomendação de prioridade com motivo.
**`items.priority` continua sendo o único dado de prioridade persistido**
(`alta`/`média`/`baixa`/`null`, sem mudança de valores possíveis). A lógica
da Matriz de Eisenhower (importância × urgência) foi incorporada só como
critério **interno** do `ORGANIZE_SYSTEM_PROMPT` — a IA nunca devolve
quadrante, só o nível de prioridade já existente. Critério explícito dado à
IA: `alta` exige base concreta no texto (prazo próximo, compromisso,
consequência relevante); `média` é importante/merece planejamento sem
urgência suficiente para `alta`; `baixa` pode esperar sem consequência
evidente; `null` quando não há contexto suficiente para recomendar com
segurança. Instrução explícita para nunca inventar prazo, urgência,
consequência, compromisso com terceiros ou importância não declarada, e
para não usar `alta` por padrão.
**`priority_reason`, novo campo só de resposta, nunca persistido:** a
mesma resposta JSON da Anthropic passou a incluir `priority_reason` (frase
curta, até 160 code points, explicando só o motivo da prioridade,
rastreável ao texto do usuário; `null` se `priority` for `null`).
`parseOrganizedItem()` valida esse campo com o mesmo padrão defensivo já
usado nos demais (tipo errado ou acima do limite descarta a sugestão
inteira; string vazia após `trim()` vira `null`). `priorityReason` viaja
só entre Anthropic → parser → retorno de `organizeBrainDump()` →
interface — o `insert` em `items` continua exatamente como na Fase 4, sem
nenhuma coluna nova.
**Rótulos de apresentação (`src/app/entrada/BrainDumpForm.tsx`):**
conversão só de exibição, sem tocar no banco — `alta` → "Fazer primeiro",
`média` → "Planejar", `baixa` → "Pode esperar", `null` (ou qualquer valor
fora do esperado) → "Precisa de mais contexto". Substituiu o texto técnico
"Prioridade sugerida: alta" por um rótulo direto, mais o motivo quando
existe. Mesma `/entrada`, mesmo card já existente, sem tela nova.
**IA continua só recomendando:** `needs_confirmation` continua sempre
`true`, sem nenhum botão de confirmar/ajustar/aceitar nesta fase — decisão
e execução ficam para fases futuras.
**Testado manualmente, 4 casos reais, todos aprovados pelo usuário:**
prazo explícito ("apresentação para sexta-feira") → "Fazer primeiro" com
motivo citando o prazo; pensamento vago ("café") → "Precisa de mais
contexto", sem inventar prazo/urgência/consequência; importante sem
urgência imediata ("organizar documentos este mês") → "Planejar"; sem
prazo nem consequência ("pesquisar decoração algum dia") → "Pode esperar".
**Fora do escopo:** planejamento do dia, agenda, Google Calendar, Time
Blocking, notificações, automações, histórico/listagem de items,
confirmação/aceite pelo usuário, ranking de vários items simultâneos,
qualquer tela nova.

---

### Adoção da Supabase CLI para migrations

**Decisão:** `supabase` como devDependency local (`npm install --save-dev
supabase`), não instalação global — mesma versão fixada em
`package.json` para todo o time. Sem CI/CD de banco nesta etapa — só o
mecanismo mínimo local e reproduzível (`supabase migration new`,
`supabase db push`), como pedido explicitamente.
**Reconciliação da migration `0001`:** ela havia sido aplicada
manualmente pelo SQL Editor antes da CLI existir no projeto, então o
histórico remoto (`supabase_migrations.schema_migrations`) não tinha
registro dela. Reconciliada com `supabase migration repair 0001 --status
applied --linked`, sem reexecutar o SQL — confirmado antes com
`supabase migration list --linked` e `supabase db push --dry-run` que não
havia divergência nem risco de recriação. Migration `0001` não foi
renomeada (o nome já era o identificador de versão usado na reconciliação;
renomear não traria benefício).
**Nomenclatura:** `supabase migration new <nome>` gera arquivos com
prefixo de timestamp UTC de 14 dígitos (`YYYYMMDDHHMMSS_nome.sql`),
confirmado empiricamente com a versão instalada (`2.115.0`), não só pela
documentação (que não detalhava o formato exato).
**`supabase/config.toml` e `supabase/.gitignore`** foram gerados por
`supabase init` e são seguros para versionar — nenhum segredo literal
neles; todo campo sensível usa `env(NOME_DA_VARIAVEL)`.
