// Dublê de teste de src/lib/conversation/calendar-query.ts — NUNCA
// importado por src/. Mesmo racional dos demais dublês em tests/support/:
// evita carregar o arquivo real (e, através dele, `../google/calendar` →
// `next/headers`) fora do runtime do Next.js, sem exigir parâmetro de
// injeção de dependência na API de produção real.
//
// Usado SOMENTE pelos testes de conversation-turn.ts — os testes do
// próprio calendar-query.ts continuam importando e exercitando o módulo
// REAL (tests/conversation/calendar-query.test.mjs usa o caminho
// `../../src/lib/conversation/calendar-query.ts`, uma string de specifier
// diferente do `./calendar-query` escrito dentro de conversation-turn.ts,
// nunca interceptada por este redirect).
//
// Nenhuma lógica de domínio (resolução de relative_day, validação de
// timezone) é duplicada aqui — só delegação para um handler configurável
// por teste.
function unconfigured(name) {
  return async (...args) => {
    throw new Error(`${name} (dublê) não foi configurado para este teste — chamado com ${JSON.stringify(args)}`);
  };
}

export const handlers = {
  resolveCalendarQuery: unconfigured('resolveCalendarQuery'),
};

export async function resolveCalendarQuery(...args) {
  return handlers.resolveCalendarQuery(...args);
}
