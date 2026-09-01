// Dublê de teste de src/lib/conversation/calendar-event-cancel.ts — NUNCA
// importado por src/. Mesmo racional dos demais dublês em tests/support/
// (fake-local-task-execution.mjs/fake-runtime-state-storage.mjs): evita
// que os testes de proposal-turn.ts precisem de Supabase real (o módulo
// real, através de ../supabase/server, depende de next/headers), sem
// exigir nenhum parâmetro de injeção de dependência na API de produção
// real.
//
// Usado SOMENTE pelos testes de proposal-turn.ts, via o redirect exato
// `./calendar-event-cancel` em tests/support/ts-extension-loader.mjs — os
// testes do próprio calendar-event-cancel.ts continuam importando e
// exercitando o módulo REAL
// (tests/conversation/calendar-event-cancel.test.mjs usa o caminho
// `../../src/lib/conversation/calendar-event-cancel.ts`, uma string de
// specifier diferente, nunca interceptada por este redirect). Nenhuma
// lógica de domínio (chamada da RPC, validação defensiva do retorno) é
// duplicada aqui — só delegação para um handler configurável por teste.
function unconfigured(name) {
  return async (...args) => {
    throw new Error(`${name} (dublê) não foi configurado para este teste — chamado com ${JSON.stringify(args)}`);
  };
}

export const handlers = {
  cancelCalendarEventProposal: unconfigured('cancelCalendarEventProposal'),
};

export async function cancelCalendarEventProposal(...args) {
  return handlers.cancelCalendarEventProposal(...args);
}
