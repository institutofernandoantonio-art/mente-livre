// Dublê de teste de src/lib/conversation/calendar-event-confirmation.ts —
// NUNCA importado por src/. Mesmo racional dos demais dublês em
// tests/support/ (fake-local-task-execution.mjs/fake-calendar-event-
// cancel.mjs): evita que os testes de proposal-turn.ts precisem executar
// o orquestrador real (que, transitivamente, chamaria claim/execução
// Google/finalize reais).
//
// Usado SOMENTE pelos testes de proposal-turn.ts, via o redirect exato
// `./calendar-event-confirmation` em
// tests/support/ts-extension-loader.mjs — os testes do próprio
// calendar-event-confirmation.ts continuam importando e exercitando o
// módulo REAL (tests/conversation/calendar-event-confirmation.test.mjs
// usa o caminho `../../src/lib/conversation/calendar-event-confirmation.ts`,
// specifier distinto, nunca interceptado por este redirect). Nenhuma
// lógica de domínio (claim/Google/finalize) é duplicada aqui — só
// delegação para um handler configurável por teste.
function unconfigured(name) {
  return async (...args) => {
    throw new Error(`${name} (dublê) não foi configurado para este teste — chamado com ${JSON.stringify(args)}`);
  };
}

export const handlers = {
  confirmCalendarEvent: unconfigured('confirmCalendarEvent'),
};

export async function confirmCalendarEvent(...args) {
  return handlers.confirmCalendarEvent(...args);
}
