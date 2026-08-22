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
