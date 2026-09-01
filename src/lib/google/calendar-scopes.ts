// Lista canônica dos escopos OAuth do Google Calendar exigidos por esta
// V1 — ÚNICA fonte de verdade em todo o projeto; nenhum outro módulo
// declara uma string de escopo solta.
//
// Vive num arquivo PRÓPRIO, separado de `./calendar.ts`, porque aquele
// arquivo tem `'use server'` no topo (Server Actions) — arquivos `'use
// server'` só podem exportar funções async (restrição do próprio
// Next.js: toda exportação vira referência de Server Action); exportar
// uma constante/array dali quebra o build (`A "use server" file can only
// export async functions, found object.`). `calendar.ts`
// (`connectGoogleCalendar`) e o callback do OAuth
// (`src/app/conectar-google-calendar/callback/route.ts`) importam esta
// MESMA constante — nenhum dos dois declara uma segunda lista.
//
// Subfase 7 da criação de compromissos no Google Calendar (ampliação
// controlada do OAuth para escrita na agenda principal): dois escopos,
// ambos de MENOR privilégio possível para o que esta V1 realmente
// precisa:
//
// - `calendar.events.freebusy`: "See the availability on Google
//   calendars you have access to" — só disponibilidade, já em uso desde
//   a subfase de consulta de agenda.
//
// - `calendar.events.owned`: "See, create, change, and delete events on
//   Google calendars you own" (descrição exata do discovery document
//   oficial do Google, `https://www.googleapis.com/discovery/v1/apis/
//   calendar/v3/rest`) — escolhido em vez de `calendar.events` ("View
//   and edit events on all your calendars", que cobre também agendas
//   COMPARTILHADAS por terceiros) porque toda a escrita desta V1 é
//   hardcoded em `calendarId=primary`
//   (`../conversation/calendar-event-execution.ts`) — `primary` é, pela
//   própria definição da Calendar API, sempre a agenda do usuário
//   autenticado, nunca de outra pessoa, então `.owned` já cobre com
//   segurança todo `events.insert` que este app algum dia fará, sem
//   conceder a permissão (desnecessária aqui) de escrever em agendas de
//   terceiros. Nunca `calendar` (escopo mais amplo: gerencia/apaga
//   agendas inteiras, ACLs, etc. — nada disso é usado nesta V1).
//
// --- Consentimento parcial ------------------------------------------------
//
// Solicitar dois escopos ao mesmo tempo reabre o risco de consentimento
// PARCIAL (usuário desmarca um dos dois na tela do Google) — por isso o
// callback (Subfase 7) NUNCA confia cegamente no sucesso da troca de
// código: lê o campo `scope` devolvido pelo próprio token endpoint do
// Google (mecanismo oficial e documentado — "To check whether the user
// has granted your application access to a particular scope, examine the
// scope field in the access token response") e só chama
// `reconnect_google_calendar` se TODOS os escopos desta lista estiverem
// presentes no que foi realmente concedido. Uma concessão parcial nunca
// substitui uma conexão existente e nunca é reportada como "conectado".
export const GOOGLE_CALENDAR_REQUIRED_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events.freebusy',
  'https://www.googleapis.com/auth/calendar.events.owned',
] as const;
