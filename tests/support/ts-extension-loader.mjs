// Loader de resolução de módulos ESM — SÓ para rodar os testes deste
// projeto via `node`, nunca usado pelo app em si.
//
// Faz duas coisas, ambas exclusivas ao processo de teste:
//
// 1. Extensão automática: o código-fonte de `src/` usa imports relativos
//    sem extensão (`./state`, `./proposed-action`, ...), resolvidos
//    nativamente pelo bundler do Next.js/Turbopack (moduleResolution
//    "bundler" do tsconfig). O resolvedor ESM do Node puro não faz esse
//    mesmo trabalho — exige a extensão explícita. Esta parte do hook
//    intercepta só as resoluções que falhariam por causa disso e tenta de
//    novo com `.ts` no fim.
//
// 2. Redireciona para os dublês de teste: `conversation-turn.ts` importa
//    estaticamente `./runtime-state-storage` e `./orchestration` — exatamente
//    como fará em produção (nenhum parâmetro de injeção de dependência
//    existe na API real). Esses dois módulos reais transitivamente
//    dependem de `next/headers`, que não resolve fora do runtime do
//    Next.js. Em vez de mudar a forma como o código de produção carrega
//    essas dependências, este hook substitui SÓ a resolução desses dois
//    specifiers, só neste processo de teste, pelos dublês em
//    fake-runtime-state-storage.mjs/fake-orchestration.mjs — o arquivo de
//    produção nunca sabe disso e nunca muda.
//
//    `local-task-execution.ts` importa estaticamente `../supabase/server`
//    (mesmo módulo real já usado por runtime-state-storage.ts, mesmo
//    motivo: depende de `next/headers`) — redirecionado, pelo mesmo
//    mecanismo, para fake-supabase-server.mjs.
//
//    `proposal-turn.ts` importa estaticamente `./local-task-execution`
//    (que, através de `../supabase/server`, também depende de
//    `next/headers`) — redirecionado para fake-local-task-execution.mjs.
//    Specifier exato (`./local-task-execution`, o literal escrito em
//    proposal-turn.ts), nunca colide com
//    tests/conversation/local-task-execution.test.mjs, que importa o
//    módulo real por um caminho relativo diferente
//    (`../../src/lib/conversation/local-task-execution.ts`) — uma string
//    de specifier distinta, nunca encontrada por este Map.
//
// API 100% nativa do Node (`node:module`), nenhuma dependência nova.
const REDIRECTS = new Map([
  ['./runtime-state-storage', new URL('./fake-runtime-state-storage.mjs', import.meta.url).href],
  ['./orchestration', new URL('./fake-orchestration.mjs', import.meta.url).href],
  ['../supabase/server', new URL('./fake-supabase-server.mjs', import.meta.url).href],
  ['./local-task-execution', new URL('./fake-local-task-execution.mjs', import.meta.url).href],
]);

export async function resolve(specifier, context, nextResolve) {
  const redirect = REDIRECTS.get(specifier);
  if (redirect) {
    return nextResolve(redirect, context);
  }

  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    const isRelative = specifier.startsWith('./') || specifier.startsWith('../');
    const hasExtension = /\.[a-zA-Z]+$/.test(specifier);
    if (isRelative && !hasExtension) {
      return nextResolve(`${specifier}.ts`, context);
    }
    throw err;
  }
}
