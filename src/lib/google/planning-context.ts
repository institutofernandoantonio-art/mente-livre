'use server';
import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { getGoogleCalendarBusyTimes, type GoogleCalendarBusyBlock } from './calendar';

const FALLBACK_WINDOW_DAYS = 7;

// ---------------------------------------------------------------------
// Janela temporal
//
// TODO FUTURO: substituir a resolução textual mínima abaixo
// (resolvePlanningWindow / detectWindowKind) por uma temporalWindow
// estruturada, produzida pela camada de entendimento conversacional/IA
// (voz/texto → intenção → temporalWindow estruturada). Esta é a fronteira
// arquitetural a substituir depois — nada além destas duas funções deve
// depender de como a janela é resolvida hoje; o resto do arquivo (cálculo
// de contexto do Calendar) já trabalha só com PlanningWindow, não com
// texto. Nenhuma implementação futura está aqui, só o registro do limite.
// ---------------------------------------------------------------------
export type PlanningWindow =
  | { kind: 'today'; start: Date; end: Date; windowDays: 1 }
  | { kind: 'tomorrow'; start: Date; end: Date; windowDays: 1 }
  | { kind: 'next_7_days'; start: Date; end: Date; windowDays: 7 };

// Contexto factual e determinístico da agenda — nunca os blocos brutos
// (start/end), só agregados. Sem inferência de duração, sem afirmar que
// uma tarefa "cabe" em algum intervalo, sem sugerir horário específico.
export type CalendarPlanningContext = {
  windowDays: number;
  busyBlockCount: number;
  hasOpenDay: boolean;
} | null;

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
}

// YYYY-MM-DD no timezone informado — usa Intl em vez de aritmética manual
// de offset, para lidar com horário de verão corretamente.
function dateKeyInTimeZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

// Início do dia civil (00:00 local) de "hoje + daysOffset" no timezone
// informado, como instante UTC — sem biblioteca de fuso: mede quanto
// tempo já passou desde a meia-noite local (via Intl) e subtrai isso de
// "agora". Isso dá o instante UTC da meia-noite local, qualquer que seja
// o offset — imprecisão só é possível na própria hora de uma transição de
// horário de verão, aceitável para esta janela informativa.
function startOfDayInTimeZone(now: Date, timeZone: string, daysOffset: number): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(now);

  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const msSinceLocalMidnight =
    ((part('hour') % 24) * 3600 + part('minute') * 60 + part('second')) * 1000 +
    now.getMilliseconds();

  const startOfToday = new Date(now.getTime() - msSinceLocalMidnight);
  return new Date(startOfToday.getTime() + daysOffset * 24 * 60 * 60 * 1000);
}

function next7DaysWindow(now: Date): PlanningWindow {
  return {
    kind: 'next_7_days',
    start: now,
    end: new Date(now.getTime() + FALLBACK_WINDOW_DAYS * 24 * 60 * 60 * 1000),
    windowDays: FALLBACK_WINDOW_DAYS,
  };
}

// Vocabulário mínimo e temporário (ver TODO FUTURO acima) — não é, e não
// deve virar, um parser de datas: só reconhece estas 3 expressões
// literais, case-insensitive. Nunca interpreta dias da semana, datas
// numéricas ("dia 15"), nem expressões relativas além destas.
function detectWindowKind(rawText: string): 'today' | 'tomorrow' | 'next_7_days' {
  const text = rawText.toLowerCase();
  if (text.includes('amanhã')) {
    return 'tomorrow';
  }
  if (text.includes('hoje') || text.includes('ainda hoje')) {
    return 'today';
  }
  if (text.includes('esta semana') || text.includes('essa semana')) {
    return 'next_7_days';
  }
  return 'next_7_days';
}

// Relê brain_dumps.raw_text só server-side, com ownership verificado —
// nunca aceita raw_text do cliente, nunca o retorna, nunca o loga. Falha
// de qualquer tipo (linha ausente/de outro dono, erro de leitura,
// timezone inválido/ausente) sempre cai no fallback seguro de 7 dias,
// nunca lança erro visível.
async function resolvePlanningWindow(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  brainDumpId: string,
  resolvedTimeZone: string | null,
): Promise<PlanningWindow> {
  const now = new Date();

  if (!resolvedTimeZone) {
    return next7DaysWindow(now);
  }

  const { data: brainDump, error } = await supabase
    .from('brain_dumps')
    .select('raw_text')
    .eq('id', brainDumpId)
    .eq('user_id', userId)
    .single();

  if (error || !brainDump) {
    return next7DaysWindow(now);
  }

  const kind = detectWindowKind(brainDump.raw_text);

  if (kind === 'today') {
    return {
      kind: 'today',
      start: now,
      end: startOfDayInTimeZone(now, resolvedTimeZone, 1),
      windowDays: 1,
    };
  }

  if (kind === 'tomorrow') {
    return {
      kind: 'tomorrow',
      start: startOfDayInTimeZone(now, resolvedTimeZone, 1),
      end: startOfDayInTimeZone(now, resolvedTimeZone, 2),
      windowDays: 1,
    };
  }

  return next7DaysWindow(now);
}

// Nunca confia nos blocos além de start/end — não os devolve, só deriva
// contagens/booleanos determinísticos a partir da janela já resolvida.
// Esta função não decide mais sozinha que "são sempre 7 dias" — só
// trabalha com a PlanningWindow que já recebeu pronta.
function computePlanningContext(
  busyBlocks: GoogleCalendarBusyBlock[],
  window: PlanningWindow,
  timeZone: string,
): CalendarPlanningContext {
  const windowStartMs = window.start.getTime();
  const windowEndMs = window.end.getTime();

  const dayKeys: string[] = [];
  for (let cursor = windowStartMs; cursor < windowEndMs; cursor += 24 * 60 * 60 * 1000) {
    dayKeys.push(dateKeyInTimeZone(new Date(cursor), timeZone));
  }
  if (dayKeys.length === 0) {
    dayKeys.push(dateKeyInTimeZone(window.start, timeZone));
  }

  const occupiedDayKeys = new Set<string>();
  for (const block of busyBlocks) {
    const start = new Date(block.start);
    const end = new Date(block.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      continue;
    }

    const clampedStart = Math.max(start.getTime(), windowStartMs);
    const clampedEnd = Math.min(end.getTime(), windowEndMs);
    if (clampedEnd < clampedStart) {
      continue;
    }

    // Marca todo dia de calendário tocado pelo bloco, dentro da janela —
    // laço limitado, nunca pode crescer sem limite.
    let cursor = clampedStart;
    let steps = 0;
    const maxSteps = dayKeys.length + 1;
    while (cursor <= clampedEnd && steps <= maxSteps) {
      occupiedDayKeys.add(dateKeyInTimeZone(new Date(cursor), timeZone));
      cursor += 24 * 60 * 60 * 1000;
      steps++;
    }
    occupiedDayKeys.add(dateKeyInTimeZone(new Date(clampedEnd), timeZone));
  }

  const hasOpenDay = dayKeys.some((key) => !occupiedDayKeys.has(key));

  return {
    windowDays: window.windowDays,
    busyBlockCount: busyBlocks.length,
    hasOpenDay,
  };
}

// Etapa isolada e opcional, sem IA: só transforma disponibilidade real do
// Calendar num resumo factual mínimo, complementar ao planSuggestion já
// gerado por organizeBrainDump() — nunca o substitui, nunca influencia
// priority/category, nunca envia busy blocks para fora deste servidor.
export async function getCalendarPlanningContext(
  brainDumpId: string,
  timezone: string | null,
): Promise<CalendarPlanningContext> {
  if (typeof brainDumpId !== 'string' || !brainDumpId) {
    return null;
  }

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims.sub;

  if (!userId) {
    return null;
  }

  // Confirma que existe um item para este brain dump pertencente ao
  // usuário atual — RLS (items_select_own) já impede ler linha de outro
  // dono; o filtro explícito por user_id é reforço, não a única barreira.
  const { data: item, error: itemError } = await supabase
    .from('items')
    .select('id')
    .eq('brain_dump_id', brainDumpId)
    .eq('user_id', userId)
    .single();

  if (itemError || !item) {
    return null;
  }

  const resolvedTimeZone = timezone && isValidTimeZone(timezone) ? timezone : null;

  const window = await resolvePlanningWindow(supabase, userId, brainDumpId, resolvedTimeZone);

  const busyBlocks = await getGoogleCalendarBusyTimes(
    window.start.toISOString(),
    window.end.toISOString(),
  );

  if (!busyBlocks) {
    // Sem conexão com o Calendar, ou qualquer falha na leitura — tratado
    // como qualquer outra falha silenciosa já usada no resto do projeto,
    // nunca exposto como erro técnico ao usuário.
    return null;
  }

  return computePlanningContext(busyBlocks, window, resolvedTimeZone ?? 'UTC');
}
