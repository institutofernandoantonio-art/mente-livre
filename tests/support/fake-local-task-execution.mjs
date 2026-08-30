// Dublê de teste de src/lib/conversation/local-task-execution.ts — NUNCA
// importado por src/. Mesmo racional dos demais dublês em tests/support/
// (fake-runtime-state-storage.mjs/fake-orchestration.mjs/
// fake-supabase-server.mjs): evita que os testes de proposal-turn.ts
// precisem de Supabase real (o módulo real, através de
// ../supabase/server, depende de next/headers), sem exigir nenhum
// parâmetro de injeção de dependência na API de produção real.
//
// Usado SOMENTE pelos testes de proposal-turn.ts, via o redirect exato
// `./local-task-execution` em tests/support/ts-extension-loader.mjs — os
// testes do próprio local-task-execution.ts continuam importando e
// exercitando o módulo REAL (tests/conversation/local-task-execution.test.mjs
// usa o caminho `../../src/lib/conversation/local-task-execution.ts`, uma
// string de specifier diferente, nunca interceptada por este redirect).
// Nenhuma lógica de domínio (mapeamento de task, conversão de now, parsing
// do retorno da RPC) é duplicada aqui — só delegação para um handler
// configurável por teste.
function unconfigured(name) {
  return async (...args) => {
    throw new Error(`${name} (dublê) não foi configurado para este teste — chamado com ${JSON.stringify(args)}`);
  };
}

export const handlers = {
  executeCreateLocalTask: unconfigured('executeCreateLocalTask'),
};

export async function executeCreateLocalTask(...args) {
  return handlers.executeCreateLocalTask(...args);
}
