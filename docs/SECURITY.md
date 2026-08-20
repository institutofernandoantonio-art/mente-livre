# Segurança — Mente Livre

Princípios e mecanismos de segurança do projeto. Para a arquitetura técnica
geral, ver [`ARCHITECTURE.md`](./ARCHITECTURE.md). Para o motivo/data de
cada decisão específica, ver [`DECISIONS.md`](./DECISIONS.md).

## Princípios estruturais (válidos desde a V1)

Registrados originalmente em `PROJECT_CONTEXT.md` em 2026-08-19, a pedido do
usuário, como requisito estrutural — não algo a adiar para quando os módulos
futuros (autoconhecimento/dados sensíveis) chegarem:

- princípio de menor privilégio;
- RLS rigoroso, com políticas explícitas por operação (não `FOR ALL`
  genérico);
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

## Padrão de RLS (Row Level Security)

Toda tabela, ao ser criada, segue o mesmo padrão — ver
[`supabase/migrations/0001_create_profiles.sql`](../supabase/migrations/0001_create_profiles.sql)
como referência canônica (tabela `profiles`, Fase 2):

1. `alter table ... enable row level security;` — habilitado explicitamente
   por tabela, sem depender de comportamento implícito do painel do
   Supabase.
2. Privilégios mínimos por papel: `revoke all ... from anon;` e
   `grant select, insert, update, delete ... to authenticated;` — `anon`
   (visitante não logado) não tem nenhum acesso à tabela; `authenticated`
   tem acesso de tabela, mas cada política abaixo ainda restringe linha por
   linha.
3. **Uma política por operação** (`select`, `insert`, `update`, `delete`),
   nunca `for all` genérico — para que cada operação tenha sua regra
   revisada individualmente. Cada política usa `auth.uid() = id` (ou
   equivalente para tabelas futuras com `user_id`) em `using`/`with check`
   conforme o caso.

Funções `security definer` (como `handle_new_user`, que cria o `profile`
automaticamente no cadastro) fixam `search_path = ''` — a versão mais
restritiva contra sequestro de search_path — e qualificam todo nome de
objeto por completo (`public.profiles`), nunca deixando a função resolver
nomes implicitamente.

## Sessão e autenticação

- **Refresh de sessão:** [`src/proxy.ts`](../src/proxy.ts) roda em toda
  requisição (exceto assets estáticos) e chama
  `await supabase.auth.getClaims()`, que valida o JWT no servidor (em vez
  de confiar direto no cookie) e renova o token quando necessário. Ver
  `docs/DECISIONS.md` para o motivo de `getClaims()` em vez de
  `getUser()`/`getSession()`.
- **Guarda contra `service_role` incorreta:** `src/proxy.ts` recusa rodar
  se `NEXT_PUBLIC_SUPABASE_ANON_KEY` parecer ser uma `service_role` key
  (decodifica só o payload do JWT para checar o `role`, nunca loga o
  valor da chave) — mesmo padrão de guarda já usado em
  `tests/security/rls.test.mjs`.
- **Login/logout:** [`src/lib/supabase/actions.ts`](../src/lib/supabase/actions.ts)
  implementa `login` (email/senha, via `signInWithPassword`) e `logout`
  (via `signOut`) como Server Functions — nunca rodam no navegador.
- **Mensagens de erro de login:** sempre genéricas ("Email ou senha
  inválidos.") — nunca revelam se o e-mail existe, se a senha está errada,
  nem qualquer detalhe da resposta do Supabase ou stack trace. Aplica o
  princípio de minimização de informação: revelar qual campo está errado
  facilitaria enumerar contas cadastradas.
- **Proteção de rotas:** `/entrada` é a única rota protegida por enquanto.
  `src/proxy.ts` reutiliza o `getClaims()` já chamado para o refresh de
  sessão (sem segundo cliente nem segunda validação) — se o pathname for
  `/entrada` e não houver sessão válida, responde com
  `NextResponse.redirect('/login')` antes de qualquer renderização,
  preservando cookies que um refresh malsucedido tenha limpado. Validado
  manualmente no navegador: acesso direto sem sessão redireciona para
  `/login`; com sessão, `/entrada` abre normalmente. Nenhuma outra rota
  exige sessão ainda.

## Segredos e variáveis de ambiente

- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — podem ficar
  visíveis no navegador (prefixo `NEXT_PUBLIC_`); quem protege os dados é a
  RLS no banco, não o sigilo dessas chaves.
- `SUPABASE_SERVICE_ROLE_KEY` — acesso total ao banco, ignorando RLS. Nunca
  pode aparecer no navegador; só é usada em rotas de backend do servidor.
- `ANTHROPIC_API_KEY` — idem, só no servidor.
- Nenhuma dessas variáveis, nem `.env.local`, é lida ou versionada por
  automações deste repositório. `.gitignore` ignora todo `.env*` exceto
  `.env.example` (que só documenta o formato, sem valores reais).

## Teste manual de isolamento RLS

[`tests/security/rls.test.mjs`](../tests/security/rls.test.mjs) (rodar com
`npm run test:rls`) é um script de verificação manual — não um teste de
framework (não há jest/vitest instalado) — que autentica dois usuários reais
via `signInWithPassword`, usando **somente a anon key** (nunca a
`service_role`, e o script recusa rodar se detectar uma). Para cada direção
(A→B e B→A) ele confirma que:

- o usuário lê o próprio perfil normalmente;
- o usuário **não** consegue ler o perfil do outro;
- o usuário **não** consegue alterar o perfil do outro;
- o usuário **não** consegue excluir o perfil do outro (e, se algum dia
  isso passar, o script tem uma rotina de recuperação que recria a linha
  apagada);
- cada usuário consegue atualizar o próprio `display_name` (e o script
  restaura o valor para `null` ao final, deixando o banco como encontrou).

Última execução conhecida (fora desta sessão, relatada pelo usuário): **11
PASS, 0 FAIL**. A lógica do script não foi alterada nesta tarefa — só os
nomes das variáveis de ambiente que ele lê (ver abaixo).

### Variáveis exigidas e onde devem vir

O script roda com `node` puro — não há `dotenv` nem nenhum outro
carregamento automático de arquivo `.env*`; ele só lê `process.env`.
Colocar uma variável em `.env.local` **não** a disponibiliza sozinho para
este teste — de qualquer forma ela precisa estar no ambiente do processo no
momento em que `npm run test:rls` roda.

| Variável | Uso | Onde deve vir |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | mesma variável usada pelo app | pode vir da configuração local já existente (não é segredo) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | mesma variável usada pelo app | pode vir da configuração local já existente (não é segredo) |
| `USER_A_EMAIL` / `USER_A_PASSWORD` | credenciais de um usuário de teste real, descartável, criado só para isso no Supabase Auth do projeto | **exportar temporariamente no terminal** antes de rodar o teste — nunca persistir em `.env.local` |
| `USER_B_EMAIL` / `USER_B_PASSWORD` | credenciais de um segundo usuário de teste, nas mesmas condições | idem — só na sessão do terminal |

Exemplo de execução:

```bash
export USER_A_EMAIL=... USER_A_PASSWORD=... USER_B_EMAIL=... USER_B_PASSWORD=...
npm run test:rls
```

Feche ou limpe a sessão do terminal depois de rodar. Nunca usar contas de
usuários finais reais para `USER_A`/`USER_B`, e nunca commitar essas
credenciais em nenhum arquivo.
