// Dublê de teste de src/lib/conversation/orchestration.ts — NUNCA
// importado por src/. Mesmo racional de fake-runtime-state-storage.mjs:
// evita carregar o arquivo real (e, através dele, reference-resolution.ts
// → `next/headers`) fora do runtime do Next.js, sem parâmetro de injeção
// na API de produção. `resolveClarificationTurn` já é testada em sua
// própria subfase — aqui só controlamos o que ela DEVOLVE, nunca
// reimplementamos sua lógica.
function unconfigured(name) {
  return async (...args) => {
    throw new Error(`${name} (dublê) não foi configurado para este teste — chamado com ${JSON.stringify(args)}`);
  };
}

export const handlers = {
  resolveClarificationTurn: unconfigured('resolveClarificationTurn'),
};

export async function resolveClarificationTurn(...args) {
  return handlers.resolveClarificationTurn(...args);
}
