import assert from 'node:assert/strict';
import { suggestCalendarAlternativeTimes } from '../../src/lib/conversation/calendar-alternative-times.ts';
import { handlers } from '../support/fake-google-calendar.mjs';

const NOW = Date.parse('2026-09-08T16:00:00.000Z'); // 13:00 em São Paulo
const LATE_NOW = Date.parse('2026-09-09T01:16:00.000Z'); // 22:16 em São Paulo
const TZ = 'America/Sao_Paulo';

handlers.getGoogleCalendarBusyTimes = async () => [];
let result = await suggestCalendarAlternativeTimes(TZ, NOW, 15);
assert.deepEqual(result, {
  status: 'ok',
  suggestions: [
    { day: 'today', hour: 16, minute: 0, label: 'Hoje, 16:00' },
    { day: 'today', hour: 17, minute: 0, label: 'Hoje, 17:00' },
  ],
});

handlers.getGoogleCalendarBusyTimes = async () => [
  { start: '2026-09-08T19:00:00.000Z', end: '2026-09-08T20:00:00.000Z' }, // 16:00-17:00 local
];
result = await suggestCalendarAlternativeTimes(TZ, NOW, 15);
assert.deepEqual(result, {
  status: 'ok',
  suggestions: [
    { day: 'today', hour: 17, minute: 0, label: 'Hoje, 17:00' },
    { day: 'today', hour: 18, minute: 0, label: 'Hoje, 18:00' },
  ],
});

handlers.getGoogleCalendarBusyTimes = async () => [];
result = await suggestCalendarAlternativeTimes(TZ, LATE_NOW, 15);
assert.deepEqual(result, {
  status: 'ok',
  suggestions: [
    { day: 'tomorrow', hour: 7, minute: 0, label: 'Amanhã, 07:00' },
    { day: 'tomorrow', hour: 8, minute: 0, label: 'Amanhã, 08:00' },
  ],
});

handlers.getGoogleCalendarBusyTimes = async () => null;
assert.deepEqual(await suggestCalendarAlternativeTimes(TZ, NOW, 15), { status: 'unavailable' });

assert.deepEqual(
  await suggestCalendarAlternativeTimes('Timezone/Invalida', NOW, 15),
  { status: 'invalid_timezone' },
);

console.log('[PASS] sugere os próximos blocos de 1h livres sem oferecer horário passado');
console.log('[PASS] quando o dia acabou, oferece amanhã e falha fechado se o Calendar estiver indisponível');
