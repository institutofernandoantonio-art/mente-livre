// Dublê de teste de src/lib/conversation/calendar-event-finalize.ts —
// NUNCA importado por src/. Usado SOMENTE pelos testes de
// calendar-event-confirmation.ts (o orquestrador, Subfase 9), via o
// redirect exato `./calendar-event-finalize` em
// tests/support/ts-extension-loader.mjs — os testes do próprio
// calendar-event-finalize.ts continuam importando e exercitando o
// módulo REAL (specifier distinto: `../../src/lib/conversation/calendar-
// event-finalize.ts`, nunca interceptado por este redirect). Nenhuma
// lógica de domínio (chamada da RPC, validação defensiva) é duplicada
// aqui — só delegação para um handler configurável por teste.
function unconfigured(name) {
  return async (...args) => {
    throw new Error(`${name} (dublê) não foi configurado para este teste — chamado com ${JSON.stringify(args)}`);
  };
}

export const handlers = {
  finalizeCalendarEventExecution: unconfigured('finalizeCalendarEventExecution'),
};

export async function finalizeCalendarEventExecution(...args) {
  return handlers.finalizeCalendarEventExecution(...args);
}
