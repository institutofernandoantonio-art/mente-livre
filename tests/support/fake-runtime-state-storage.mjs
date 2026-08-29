// Dublê de teste de src/lib/conversation/runtime-state-storage.ts — NUNCA
// importado por src/. Só existe para o hook de resolução em
// ts-extension-loader.mjs redirecionar, exclusivamente durante os testes,
// as três funções que conversation-turn.ts importa estaticamente daquele
// módulo real. Isso evita carregar o arquivo real (e, através dele,
// `next/headers`) fora do runtime do Next.js, sem exigir nenhum parâmetro
// de injeção de dependência na API de produção.
//
// Cada teste define o handler que precisa antes de chamar o integrador
// (ver tests/conversation/conversation-turn.test.mjs) — os defaults abaixo
// sempre lançam, para que um teste que esqueça de configurar um handler
// falhe alto e claro, em vez de silenciosamente devolver algo inválido.
function unconfigured(name) {
  return async (...args) => {
    throw new Error(`${name} (dublê) não foi configurado para este teste — chamado com ${JSON.stringify(args)}`);
  };
}

export const handlers = {
  getRuntimeState: unconfigured('getRuntimeState'),
  replaceRuntimeState: unconfigured('replaceRuntimeState'),
  advanceRuntimeState: unconfigured('advanceRuntimeState'),
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
