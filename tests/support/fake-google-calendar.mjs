// Dublê de teste de src/lib/google/calendar.ts — NUNCA importado por src/.
// Mesmo racional dos demais dublês em tests/support/: evita carregar o
// arquivo real (e, através dele, `next/headers`/`next/navigation`) fora do
// runtime do Next.js, sem exigir nenhum parâmetro de injeção de
// dependência na API de produção real.
//
// Usado SOMENTE pelos testes de calendar-query.ts (via o specifier exato
// `../google/calendar`, escrito naquele arquivo) e, transitivamente, pelos
// testes de conversation-turn.ts que exercitam query_calendar através do
// dublê de calendar-query (ver fake-calendar-query.mjs) — mas o dublê de
// calendar-query nunca importa este arquivo, então na prática só
// calendar-query.test.mjs carrega este dublê de fato.
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
};

export async function getGoogleCalendarBusyTimes(...args) {
  return handlers.getGoogleCalendarBusyTimes(...args);
}
