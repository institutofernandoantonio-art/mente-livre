// Dublê de teste de src/lib/supabase/server.ts — NUNCA importado por
// src/. Mesmo racional dos demais dublês em tests/support/
// (fake-runtime-state-storage.mjs/fake-orchestration.mjs): evita carregar
// o client real (que depende de `next/headers`, não resolvível fora do
// runtime do Next.js) sem exigir nenhum parâmetro de injeção de
// dependência na API de produção real.
// src/lib/conversation/local-task-execution.ts e (Subfase 3, 4 e 5 da
// criação de compromissos no Google Calendar) src/lib/conversation/
// calendar-event-claim.ts, src/lib/conversation/calendar-event-finalize.ts
// e src/lib/conversation/calendar-event-cancel.ts importam `createClient`
// de `../supabase/server` (mesmo specifier literal, os quatro arquivos
// vivem no mesmo diretório) — este dublê é redirecionado no lugar do
// módulo real exclusivamente durante os testes, via
// tests/support/ts-extension-loader.mjs.
//
// Expõe só `rpc`, porque é o único método de supabase-js que os quatro
// arquivos realmente chamam — nenhum outro método do client real precisa
// de dublê aqui.
function unconfigured(name) {
  return async (...args) => {
    throw new Error(`${name} (dublê) não foi configurado para este teste — chamado com ${JSON.stringify(args)}`);
  };
}

export const handlers = {
  rpc: unconfigured('supabase.rpc'),
};

export async function createClient() {
  return {
    rpc: (...args) => handlers.rpc(...args),
  };
}
