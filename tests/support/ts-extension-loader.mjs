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
//    `conversation-entry.ts` importa estaticamente `./conversation-turn`,
//    `./proposal-turn` e `./intent-extraction` (os três, transitivamente,
//    dependem de `next/headers`/Anthropic) — redirecionados, pelo mesmo
//    mecanismo, para fake-conversation-turn.mjs/fake-proposal-turn.mjs/
//    fake-intent-extraction.mjs. Mesmo cuidado de especificidade: cada um
//    desses três módulos tem seu PRÓPRIO arquivo de teste, que os importa
//    por caminhos relativos `../../src/...` diferentes do specifier
//    `./conversation-turn`/`./proposal-turn`/`./intent-extraction` escrito
//    dentro de conversation-entry.ts — nunca colidem. `./conversation-ttl`
//    (também importado por conversation-entry.ts) NÃO é redirecionado —
//    é 100% puro, sem `next/headers`, carregado real nos testes.
//
//    `actions.ts` (Server Action pública) importa estaticamente
//    `./conversation-entry` (que, transitivamente, depende de
//    `next/headers`/Anthropic) — redirecionado, pelo mesmo mecanismo, para
//    fake-conversation-entry.mjs. Mesmo cuidado de especificidade:
//    tests/conversation/conversation-entry.test.mjs importa o módulo real
//    por um caminho relativo diferente
//    (`../../src/lib/conversation/conversation-entry.ts`) — specifier
//    distinto, nunca encontrado por este Map.
//
//    `conversation-turn.ts` importa estaticamente `./calendar-query` (que,
//    através de `../google/calendar`, depende de `next/headers`) —
//    redirecionado para fake-calendar-query.mjs. Mesmo cuidado de
//    especificidade: tests/conversation/calendar-query.test.mjs importa o
//    módulo real por `../../src/lib/conversation/calendar-query.ts`,
//    specifier distinto, nunca interceptado por este redirect.
//
//    `calendar-query.ts` importa estaticamente `../google/calendar` —
//    redirecionado para fake-google-calendar.mjs. Specifier exato,
//    distinto de `./calendar` (o specifier que planning-context.ts usa
//    para o MESMO arquivo real, a partir de um diretório diferente) —
//    nunca colidem.
//
//    `conversation-turn.ts` importa estaticamente
//    `./calendar-event-availability` (que, através de `../google/calendar`,
//    também depende de `next/headers`) — redirecionado para
//    fake-calendar-event-availability.mjs, pelo MESMO motivo/racional de
//    `./calendar-query` acima (controle direto de
//    available/busy/unavailable, sem fabricar blocos ocupados). Mesmo
//    cuidado de especificidade: um futuro
//    tests/conversation/calendar-event-availability.test.mjs importaria o
//    módulo real por `../../src/lib/conversation/calendar-event-
//    availability.ts`, specifier distinto, nunca interceptado por este
//    redirect. `buildCreateCalendarEventAction` (`./calendar-event-
//    proposal`) NUNCA é redirecionado — é 100% puro (Subfase 1), carregado
//    real nos testes, mesmo padrão já usado para `buildProposedAction`.
//
// API 100% nativa do Node (`node:module`), nenhuma dependência nova.
const REDIRECTS = new Map([
  ['./runtime-state-storage', new URL('./fake-runtime-state-storage.mjs', import.meta.url).href],
  ['./orchestration', new URL('./fake-orchestration.mjs', import.meta.url).href],
  ['../supabase/server', new URL('./fake-supabase-server.mjs', import.meta.url).href],
  ['./local-task-execution', new URL('./fake-local-task-execution.mjs', import.meta.url).href],
  ['./conversation-turn', new URL('./fake-conversation-turn.mjs', import.meta.url).href],
  ['./proposal-turn', new URL('./fake-proposal-turn.mjs', import.meta.url).href],
  ['./intent-extraction', new URL('./fake-intent-extraction.mjs', import.meta.url).href],
  ['./conversation-entry', new URL('./fake-conversation-entry.mjs', import.meta.url).href],
  ['./calendar-query', new URL('./fake-calendar-query.mjs', import.meta.url).href],
  ['../google/calendar', new URL('./fake-google-calendar.mjs', import.meta.url).href],
  [
    './calendar-event-availability',
    new URL('./fake-calendar-event-availability.mjs', import.meta.url).href,
  ],
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
