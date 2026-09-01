// Dublê de teste de src/lib/google/calendar.ts — NUNCA importado por src/.
// Mesmo racional dos demais dublês em tests/support/: evita carregar o
// arquivo real (e, através dele, `next/headers`/`next/navigation`) fora do
// runtime do Next.js, sem exigir nenhum parâmetro de injeção de
// dependência na API de produção real.
//
// Usado pelos testes de calendar-query.ts/calendar-event-availability.ts
// (via o specifier exato `../google/calendar`, escrito naqueles arquivos)
// e, transitivamente, pelos testes de conversation-turn.ts que exercitam
// query_calendar através do dublê de calendar-query (ver
// fake-calendar-query.mjs) — mas o dublê de calendar-query nunca importa
// este arquivo, então na prática só calendar-query.test.mjs carrega este
// dublê de fato. `getGoogleCalendarAccessToken` (Subfase 6 da criação de
// compromissos no Google Calendar) é usado por
// tests/conversation/calendar-event-execution.test.mjs, mesmo specifier
// `../google/calendar` escrito em calendar-event-execution.ts.
// `hasGoogleCalendarEventWriteAuthorization` (Subfase 10 — gate seguro
// para conexões antigas freebusy-only) é usado por
// tests/conversation/calendar-event-confirmation.test.mjs, mesmo
// specifier `../google/calendar` escrito em
// calendar-event-confirmation.ts.
//
// Nenhuma lógica de OAuth/refresh/token storage é duplicada aqui — só
// delegação para um handler configurável por teste.
function unconfigured(name) {
  return async (...args) => {
    throw new Error(`${name} (dublê) não foi configurado para este teste — chamado com ${JSON.stringify(args)}`);
  };
}

export const handlers = {
  getGoogleCalendarBusyTimes: unconfigured('getGoogleCalendarBusyTimes'),
  getGoogleCalendarAccessToken: unconfigured('getGoogleCalendarAccessToken'),
  hasGoogleCalendarEventWriteAuthorization: unconfigured('hasGoogleCalendarEventWriteAuthorization'),
};

export async function getGoogleCalendarBusyTimes(...args) {
  return handlers.getGoogleCalendarBusyTimes(...args);
}

export async function getGoogleCalendarAccessToken(...args) {
  return handlers.getGoogleCalendarAccessToken(...args);
}

export async function hasGoogleCalendarEventWriteAuthorization(...args) {
  return handlers.hasGoogleCalendarEventWriteAuthorization(...args);
}
