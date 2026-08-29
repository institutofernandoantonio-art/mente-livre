// Dublê de teste de src/lib/conversation/runtime-state-storage.ts — NUNCA
// importado por src/. Só existe para o hook de resolução em
// ts-extension-loader.mjs redirecionar, exclusivamente durante os testes,
// as funções que conversation-turn.ts/proposal-turn.ts importam
// estaticamente daquele módulo real. Isso evita carregar o arquivo real
// (e, através dele, `next/headers`) fora do runtime do Next.js, sem
// exigir nenhum parâmetro de injeção de dependência na API de produção.
//
// `consumeRuntimeState` foi adicionado aqui para os testes de
// proposal-turn.ts (tests/conversation/proposal-turn.test.mjs) —
// extensão aditiva, nenhum handler existente foi alterado, os testes de
// conversation-turn.ts continuam usando exatamente os três de sempre.
//
// Cada teste define o handler que precisa antes de chamar o integrador
// — os defaults abaixo sempre lançam, para que um teste que esqueça de
// configurar um handler falhe alto e claro, em vez de silenciosamente
// devolver algo inválido.
function unconfigured(name) {
  return async (...args) => {
    throw new Error(`${name} (dublê) não foi configurado para este teste — chamado com ${JSON.stringify(args)}`);
  };
}

export const handlers = {
  getRuntimeState: unconfigured('getRuntimeState'),
  replaceRuntimeState: unconfigured('replaceRuntimeState'),
  advanceRuntimeState: unconfigured('advanceRuntimeState'),
  consumeRuntimeState: unconfigured('consumeRuntimeState'),
};

export async function getRuntimeState(...args) {
  return handlers.getRuntimeState(...args);
}

export async function replaceRuntimeState(...args) {
  return handlers.replaceRuntimeState(...args);
}

export async function advanceRuntimeState(...args) {
  return handlers.advanceRuntimeState(...args);
}

export async function consumeRuntimeState(...args) {
  return handlers.consumeRuntimeState(...args);
}
