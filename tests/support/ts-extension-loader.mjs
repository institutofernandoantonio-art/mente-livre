// Loader ESM usado apenas nos testes Node do projeto.
// Resolve imports relativos sem extensão e redireciona dependências de I/O
// para dublês determinísticos. Nunca é carregado pela aplicação.
const REDIRECTS = new Map([
  ['./runtime-state-storage', new URL('./fake-runtime-state-storage.mjs', import.meta.url).href],
  ['./orchestration', new URL('./fake-orchestration.mjs', import.meta.url).href],
  ['../supabase/server', new URL('./fake-supabase-server.mjs', import.meta.url).href],
  ['./local-task-execution', new URL('./fake-local-task-execution.mjs', import.meta.url).href],
  ['./calendar-event-cancel', new URL('./fake-calendar-event-cancel.mjs', import.meta.url).href],
  ['./calendar-event-confirmation', new URL('./fake-calendar-event-confirmation.mjs', import.meta.url).href],
  ['./calendar-event-claim', new URL('./fake-calendar-event-claim.mjs', import.meta.url).href],
  ['./calendar-event-execution', new URL('./fake-calendar-event-execution.mjs', import.meta.url).href],
  ['./calendar-event-finalize', new URL('./fake-calendar-event-finalize.mjs', import.meta.url).href],
  ['./calendar-cancel-flow', new URL('./fake-calendar-cancel-flow.mjs', import.meta.url).href],
  ['./calendar-reschedule-flow', new URL('./fake-calendar-reschedule-flow.mjs', import.meta.url).href],
  ['./conversation-turn', new URL('./fake-conversation-turn.mjs', import.meta.url).href],
  ['./proposal-turn', new URL('./fake-proposal-turn.mjs', import.meta.url).href],
  ['./intent-extraction', new URL('./fake-intent-extraction.mjs', import.meta.url).href],
  ['./conversation-entry', new URL('./fake-conversation-entry.mjs', import.meta.url).href],
  ['./calendar-query', new URL('./fake-calendar-query.mjs', import.meta.url).href],
  ['../google/calendar', new URL('./fake-google-calendar.mjs', import.meta.url).href],
  ['../google/upcoming-events', new URL('./fake-upcoming-events.mjs', import.meta.url).href],
  ['./calendar-event-availability', new URL('./fake-calendar-event-availability.mjs', import.meta.url).href],
]);

export async function resolve(specifier, context, nextResolve) {
  const redirect = REDIRECTS.get(specifier);
  if (redirect) return nextResolve(redirect, context);

  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    const isRelative = specifier.startsWith('./') || specifier.startsWith('../');
    const hasExtension = /\.[a-zA-Z]+$/.test(specifier);
    if (isRelative && !hasExtension) return nextResolve(`${specifier}.ts`, context);
    throw err;
  }
}
