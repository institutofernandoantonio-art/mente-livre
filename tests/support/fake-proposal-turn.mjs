// Dublê de teste de src/lib/conversation/proposal-turn.ts — NUNCA
// importado por src/. Mesmo racional dos demais dublês em tests/support/.
// Usado SOMENTE pelos testes de conversation-entry.ts — os testes do
// próprio proposal-turn.ts continuam importando e exercitando o módulo
// REAL. Nenhuma lógica de domínio (Confirmation Policy, Execution) é
// duplicada aqui — só delegação para um handler configurável por teste.
function unconfigured(name) {
  return async (...args) => {
    throw new Error(`${name} (dublê) não foi configurado para este teste — chamado com ${JSON.stringify(args)}`);
  };
}

export const handlers = {
  resolveProposalConversationalTurn: unconfigured('resolveProposalConversationalTurn'),
};

export async function resolveProposalConversationalTurn(...args) {
  return handlers.resolveProposalConversationalTurn(...args);
}
