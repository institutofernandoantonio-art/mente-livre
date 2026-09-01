// Dublê de teste de src/lib/conversation/calendar-event-execution.ts —
// NUNCA importado por src/. Usado SOMENTE pelos testes de
// calendar-event-confirmation.ts (o orquestrador, Subfase 9), via o
// redirect exato `./calendar-event-execution` em
// tests/support/ts-extension-loader.mjs — os testes do próprio
// calendar-event-execution.ts continuam importando e exercitando o
// módulo REAL (specifier distinto: `../../src/lib/conversation/calendar-
// event-execution.ts`, nunca interceptado por este redirect). Nenhuma
// lógica de domínio (payload Google, mapeamento de status HTTP) é
// duplicada aqui — só delegação para um handler configurável por teste.
// NUNCA faz nenhuma chamada real ao Google.
function unconfigured(name) {
  return async (...args) => {
    throw new Error(`${name} (dublê) não foi configurado para este teste — chamado com ${JSON.stringify(args)}`);
  };
}

export const handlers = {
  executeCreateCalendarEvent: unconfigured('executeCreateCalendarEvent'),
};

export async function executeCreateCalendarEvent(...args) {
  return handlers.executeCreateCalendarEvent(...args);
}
