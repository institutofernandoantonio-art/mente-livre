// Dublê de teste de src/lib/conversation/calendar-event-claim.ts — NUNCA
// importado por src/. Usado SOMENTE pelos testes de
// calendar-event-confirmation.ts (o orquestrador, Subfase 9), via o
// redirect exato `./calendar-event-claim` em
// tests/support/ts-extension-loader.mjs — os testes do próprio
// calendar-event-claim.ts continuam importando e exercitando o módulo
// REAL (specifier distinto: `../../src/lib/conversation/calendar-event-
// claim.ts`, nunca interceptado por este redirect). Nenhuma lógica de
// domínio (chamada da RPC, validação defensiva) é duplicada aqui — só
// delegação para um handler configurável por teste.
function unconfigured(name) {
  return async (...args) => {
    throw new Error(`${name} (dublê) não foi configurado para este teste — chamado com ${JSON.stringify(args)}`);
  };
}

export const handlers = {
  claimCalendarEventExecution: unconfigured('claimCalendarEventExecution'),
};

export async function claimCalendarEventExecution(...args) {
  return handlers.claimCalendarEventExecution(...args);
}
