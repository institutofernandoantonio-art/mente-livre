// Dublê de teste de src/lib/conversation/calendar-event-availability.ts —
// NUNCA importado por src/. Mesmo racional dos demais dublês em
// tests/support/: usado SOMENTE pelos testes de conversation-turn.ts, para
// controlar diretamente `{status:'available'|'busy'|'unavailable'}` sem
// precisar fabricar blocos ocupados/janelas do Google — os testes do
// próprio calendar-event-availability.ts continuam importando e
// exercitando o módulo REAL (caminho relativo
// `../../src/lib/conversation/calendar-event-availability.ts`, um
// specifier diferente do `./calendar-event-availability` escrito dentro
// de conversation-turn.ts, nunca interceptado por este redirect).
function unconfigured(name) {
  return async (...args) => {
    throw new Error(`${name} (dublê) não foi configurado para este teste — chamado com ${JSON.stringify(args)}`);
  };
}

export const handlers = {
  checkCalendarEventAvailability: unconfigured('checkCalendarEventAvailability'),
};

export async function checkCalendarEventAvailability(...args) {
  return handlers.checkCalendarEventAvailability(...args);
}
