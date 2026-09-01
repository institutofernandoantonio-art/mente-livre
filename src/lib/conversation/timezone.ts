// ============================================================================
// Timezone — a ÚNICA implementação de conversão civil ↔ instante absoluto
// usada por todo o projeto (calendar-event-proposal.ts, calendar-query.ts,
// planning-context.ts) — extraída aqui exatamente para eliminar a
// duplicação de três técnicas semelhantes, uma delas comprovadamente
// incorreta em dias de transição de horário de verão (auditoria desta
// subfase — ver `resolveCivilDateTimeInTimeZone` abaixo).
//
// Zero I/O, zero `server-only`, zero dependência de Next.js/Supabase/
// Anthropic/Google, zero biblioteca externa — só `Intl.DateTimeFormat`
// (já disponível no runtime), determinístico para os mesmos argumentos.
// Nenhuma função aqui lê o relógio do sistema (`Date.now()`) nem o
// timezone do servidor — todo instante/timezone é sempre um argumento
// explícito de quem chama.
// ============================================================================

export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return false;
  }
  try {
    // Só valida que o construtor aceita o timezone — a instância em si
    // nunca é usada, existe só para o efeito de lançar em caso de valor
    // inválido.
    new Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

// --- Dia civil (calendário puro, nunca aritmética de fuso) -----------------
//
// `month` é sempre 1-12 (convenção civil/ISO 8601) em toda a API pública
// deste módulo — nunca o 0-11 de `Date`/`Date.UTC` do JavaScript. A
// conversão para 0-11 é sempre interna, nunca vazada.
export type CivilDate = { year: number; month: number; day: number };

// Lê o dia civil (ano/mês/dia) de um INSTANTE REAL num timezone — direção
// sempre seguro e nunca ambíguo: todo instante UTC corresponde a
// EXATAMENTE uma leitura de calendário em qualquer timezone (o problema de
// ambiguidade/inexistência só existe na direção OPOSTA, civil → instante,
// tratada por `resolveCivilDateTimeInTimeZone` abaixo). Usado para "hoje é
// dia X no timezone do usuário" — nunca "hoje em UTC".
export function getCivilDateInTimeZone(instant: Date, timeZone: string): CivilDate {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return { year: get('year'), month: get('month'), day: get('day') };
}

// Avança (ou recua, com `days` negativo) um número de DIAS CIVIS — nunca
// soma `days * 24h` em milissegundos, que quebraria em qualquer dia com
// 23h ou 25h reais por causa de horário de verão. `Date.UTC`/`getUTCX` são
// usados aqui SÓ como calculadora de calendário (normalizam
// automaticamente overflow de dia/mês/ano, ex.: 31 de agosto + 1 dia = 1º
// de setembro) — o resultado nunca é tratado como um instante real com
// significado de fuso, só como três números (ano/mês/dia) de volta.
export function addCivilDays(date: CivilDate, days: number): CivilDate {
  const asCalendar = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: asCalendar.getUTCFullYear(),
    month: asCalendar.getUTCMonth() + 1,
    day: asCalendar.getUTCDate(),
  };
}

// --- Civil → instante absoluto (o núcleo corrigido desta subfase) ---------

export type CivilDateTimeResolution =
  | { status: 'resolved'; utc: Date }
  // O horário civil pedido nunca existe nesse timezone (lacuna de
  // spring-forward, ex.: 2027-03-14 02:30 em America/New_York — o relógio
  // pula direto de 02:00 para 03:00 naquele dia).
  | { status: 'nonexistent' }
  // O horário civil pedido corresponde a DOIS instantes reais diferentes
  // (sobreposição de fall-back, ex.: 2027-11-07 01:30 em America/
  // New_York acontece duas vezes — uma em EDT, outra em EST).
  | { status: 'ambiguous' };

// Trata a LEITURA civil (ano/mês/dia/hora/minuto/segundo) de um instante
// real, num timezone, como se essa leitura fosse ela mesma um instante UTC
// — truque padrão para poder comparar/subtrair "quanto essa leitura civil
// vale em ms", sem nenhuma lib de fuso. Nunca usado como um instante real
// por si só, só como valor numérico de comparação.
function wallClockAsUtcMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  // `hour` pode vir '24' em alguns runtimes para meia-noite com
  // hour12:false — normalizado com % 24.
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
}

// offset(t) = leitura civil de t, tratada como ms — t (ambos em ms). Só
// tem sentido para um instante REAL `utcMs` (sempre bem definido — ver
// getCivilDateInTimeZone acima); nunca chamado com um "instante" civil
// ainda não resolvido.
function offsetMsAt(utcMs: number, timeZone: string): number {
  return wallClockAsUtcMs(utcMs, timeZone) - utcMs;
}

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

// Converte um horário civil (ano/mês/dia/hora/minuto, sempre em segundos
// zero) num instante absoluto UTC, validando por ROUND-TRIP — nunca
// aritmética confiada silenciosamente (mesmo princípio de "nunca corrigir/
// coagir, só aceitar ou rejeitar" já usado em runtime-state-validation.ts).
//
// SUBSTITUI a técnica anterior ("somar horas desde a meia-noite local"),
// que era incorreta sempre que o offset UTC do timezone mudasse entre a
// meia-noite e o horário pedido no mesmo dia civil (transição de horário
// de verão) — caso concreto confirmado nesta subfase: America/New_York,
// 2027-03-14 10:00, produzia 15:00Z em vez do correto 14:00Z.
//
// ALGORITMO (só Intl.DateTimeFormat, sem biblioteca de fuso):
// 1. Um primeiro chute: trata os números civis pedidos como se já fossem
//    UTC — não é o instante certo, mas é um ponto de partida real e
//    determinístico para sondar o offset vigente por perto.
// 2. Mede o offset vigente 12h ANTES e 12h DEPOIS desse chute corrigido
//    uma vez — uma janela de 24h ao redor de qualquer ponto do dia civil
//    pedido sempre cobre uma eventual transição de horário de verão
//    daquele dia (transições reais acontecem no máximo 1x por dia civil,
//    a uma hora fixa — nunca mais de uma vez em 24h, para qualquer
//    timezone IANA moderno).
// 3. Constrói um candidato para cada um dos dois offsets encontrados.
// 4. Round-trip: só aceita um candidato se, formatado de volta no MESMO
//    timezone, reproduzir EXATAMENTE os componentes civis pedidos.
// 5. Nenhum candidato bate -> `nonexistent`. Os dois batem E são instantes
//    DIFERENTES -> `ambiguous`. Exatamente um bate (ou os dois convergem
//    para o mesmo instante, o caso normal/não-transição) -> `resolved`.
//
// ESCOPO: cobre corretamente qualquer timezone IANA moderno com no máximo
// uma transição de horário de verão por dia civil (todos os casos reais
// observáveis nos dados de fuso atuais — deslocamentos históricos
// extraordinários, como o pulo de um dia inteiro de Samoa em 2011, estão
// fora de escopo desta versão).
export function resolveCivilDateTimeInTimeZone(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): CivilDateTimeResolution {
  const desiredAsUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0);

  // Chute real de partida — offset vigente NO INSTANTE que os números
  // civis pedidos representariam se fossem UTC (sempre um instante real
  // bem definido, mesmo que numericamente "errado").
  const seedOffset = offsetMsAt(desiredAsUtcMs, timeZone);
  const seedCandidate = desiredAsUtcMs - seedOffset;

  // Sonda o offset bem antes e bem depois do chute — cobre qualquer
  // transição do dia civil pedido, venha o chute de qual lado vier dela.
  const offsetBefore = offsetMsAt(seedCandidate - TWELVE_HOURS_MS, timeZone);
  const offsetAfter = offsetMsAt(seedCandidate + TWELVE_HOURS_MS, timeZone);

  const candidateBefore = desiredAsUtcMs - offsetBefore;
  const candidateAfter = desiredAsUtcMs - offsetAfter;

  const matchesBefore = wallClockAsUtcMs(candidateBefore, timeZone) === desiredAsUtcMs;
  const matchesAfter = wallClockAsUtcMs(candidateAfter, timeZone) === desiredAsUtcMs;

  if (matchesBefore && matchesAfter) {
    if (candidateBefore === candidateAfter) {
      // Caso normal — nenhuma transição relevante, os dois lados
      // convergem para o mesmo instante real.
      return { status: 'resolved', utc: new Date(candidateBefore) };
    }
    // Dois instantes reais DIFERENTES, ambos batendo com o mesmo horário
    // civil pedido — sobreposição de fall-back.
    return { status: 'ambiguous' };
  }

  if (matchesBefore) {
    return { status: 'resolved', utc: new Date(candidateBefore) };
  }
  if (matchesAfter) {
    return { status: 'resolved', utc: new Date(candidateAfter) };
  }

  // Nenhum dos dois candidatos bate — o horário civil pedido nunca existe
  // nesse timezone (lacuna de spring-forward).
  return { status: 'nonexistent' };
}
