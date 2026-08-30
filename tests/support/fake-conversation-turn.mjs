// Dublê de teste de src/lib/conversation/conversation-turn.ts — NUNCA
// importado por src/. Mesmo racional dos demais dublês em tests/support/:
// evita carregar o arquivo real (e, através dele, `next/headers` via
// runtime-state-storage.ts) fora do runtime do Next.js, sem exigir
// nenhum parâmetro de injeção de dependência na API de produção real.
//
// Usado SOMENTE pelos testes de conversation-entry.ts — os testes do
// próprio conversation-turn.ts continuam importando e exercitando o
// módulo REAL (tests/conversation/conversation-turn.test.mjs usa o
// caminho `../../src/lib/conversation/conversation-turn.ts`, uma string
// de specifier diferente, nunca interceptada por este redirect).
// Nenhuma lógica de domínio (CAS, presentation data, TTL) é duplicada
// aqui — só delegação para handlers configuráveis por teste.
function unconfigured(name) {
  return async (...args) => {
    throw new Error(`${name} (dublê) não foi configurado para este teste — chamado com ${JSON.stringify(args)}`);
  };
}

export const handlers = {
  resolveFirstConversationalTurn: unconfigured('resolveFirstConversationalTurn'),
  resolveClarificationConversationalTurn: unconfigured('resolveClarificationConversationalTurn'),
};

export async function resolveFirstConversationalTurn(...args) {
  return handlers.resolveFirstConversationalTurn(...args);
}

export async function resolveClarificationConversationalTurn(...args) {
  return handlers.resolveClarificationConversationalTurn(...args);
}
