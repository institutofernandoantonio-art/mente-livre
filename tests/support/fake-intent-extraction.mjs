// Dublê de teste de src/lib/conversation/intent-extraction.ts — NUNCA
// importado por src/. Mesmo racional dos demais dublês em tests/support/:
// evita que os testes de conversation-entry.ts precisem de Anthropic
// real (o módulo real usa `fetch()` cru para a API de Messages). Usado
// SOMENTE pelos testes de conversation-entry.ts — os testes do próprio
// intent-extraction.ts continuam importando e exercitando o módulo REAL
// (via swap de `globalThis.fetch`, não este dublê). Nenhuma lógica de
// domínio (prompt, parsing, validação de StructuredIntent) é duplicada
// aqui — só delegação para um handler configurável por teste.
function unconfigured(name) {
  return async (...args) => {
    throw new Error(`${name} (dublê) não foi configurado para este teste — chamado com ${JSON.stringify(args)}`);
  };
}

export const handlers = {
  extractStructuredIntent: unconfigured('extractStructuredIntent'),
};

export async function extractStructuredIntent(...args) {
  return handlers.extractStructuredIntent(...args);
}
