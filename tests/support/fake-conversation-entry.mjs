// Dublê de teste de src/lib/conversation/conversation-entry.ts — NUNCA
// importado por src/. Mesmo racional dos demais dublês em tests/support/:
// evita carregar o arquivo real (e, através dele, `next/headers`/Anthropic
// via runtime-state-storage.ts/intent-extraction.ts) fora do runtime do
// Next.js, sem exigir nenhum parâmetro de injeção de dependência na API de
// produção real.
//
// Usado SOMENTE pelos testes de actions.ts — os testes do próprio
// conversation-entry.ts continuam importando e exercitando o módulo REAL
// (tests/conversation/conversation-entry.test.mjs usa o caminho
// `../../src/lib/conversation/conversation-entry.ts`, uma string de
// specifier diferente, nunca interceptada pelo redirect deste dublê).
// Nenhuma lógica de domínio (roteamento, NLU, TTLs, tradução de status) é
// duplicada aqui — só delegação para um handler configurável por teste.
function unconfigured(name) {
  return async (...args) => {
    throw new Error(`${name} (dublê) não foi configurado para este teste — chamado com ${JSON.stringify(args)}`);
  };
}

export const handlers = {
  handleConversationMessage: unconfigured('handleConversationMessage'),
};

export async function handleConversationMessage(...args) {
  return handlers.handleConversationMessage(...args);
}
