import 'server-only';
import { createClient } from '@/lib/supabase/server';
import {
  VOICE_INTERNAL_MONTHLY_CAP_MICROUSD,
  microusdToUsd,
} from './limits';

export type VoiceReservationStatus =
  | 'reserved'
  | 'duplicate'
  | 'rate_limited'
  | 'budget_exceeded'
  | 'unauthenticated'
  | 'invalid'
  | 'error';

export type VoiceUsageSummary = {
  calls: number;
  minutes: number;
  estimatedCostUsd: number;
  reservedBudgetUsd: number;
  internalLimitUsd: number;
};

type ReservationRow = {
  status: string;
  usage_id: string | null;
  month_reserved_cost_microusd: number | string | null;
};

function asInteger(value: number | string | null | undefined): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

export async function reserveVoiceUsage(input: {
  requestId: string;
}): Promise<{ status: VoiceReservationStatus; monthReservedMicrousd: number }> {
  const supabase = await createClient();

  // A fronteira pública recebe SOMENTE o request_id. Provider, modelo e
  // reserva financeira ficam fixos dentro da função privilegiada no banco.
  // Isso evita que browser/rota escolham parâmetros capazes de distorcer o
  // teto global do MVP.
  const { data, error } = await supabase.rpc('reserve_voice_transcription_usage', {
    p_request_id: input.requestId,
  });

  if (error || !Array.isArray(data) || data.length !== 1) {
    return { status: 'error', monthReservedMicrousd: 0 };
  }

  const row = data[0] as ReservationRow;
  const allowed: VoiceReservationStatus[] = [
    'reserved',
    'duplicate',
    'rate_limited',
    'budget_exceeded',
    'unauthenticated',
    'invalid',
  ];
  const status = allowed.includes(row.status as VoiceReservationStatus)
    ? (row.status as VoiceReservationStatus)
    : 'error';

  return {
    status,
    monthReservedMicrousd: asInteger(row.month_reserved_cost_microusd),
  };
}

export async function finalizeVoiceUsage(input: {
  requestId: string;
  status: 'completed' | 'failed';
  durationMs: number;
  estimatedCostMicrousd: number;
}): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('finalize_voice_transcription_usage', {
    p_request_id: input.requestId,
    p_status: input.status,
    p_duration_ms: input.durationMs,
    p_estimated_cost_microusd: input.estimatedCostMicrousd,
  });

  return error === null && data === true;
}

export async function getVoiceUsageSummary(): Promise<VoiceUsageSummary | null> {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) return null;

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  const { data, error } = await supabase
    .from('voice_transcription_usage')
    .select('status,duration_ms,estimated_cost_microusd,reserved_cost_microusd')
    .gte('created_at', monthStart.toISOString())
    .lt('created_at', nextMonth.toISOString());

  if (error || !Array.isArray(data)) return null;

  let calls = 0;
  let durationMs = 0;
  let estimatedCostMicrousd = 0;
  let reservedCostMicrousd = 0;

  for (const raw of data) {
    const row = raw as {
      status?: unknown;
      duration_ms?: unknown;
      estimated_cost_microusd?: unknown;
      reserved_cost_microusd?: unknown;
    };
    reservedCostMicrousd += asInteger(row.reserved_cost_microusd as number | string | null | undefined);
    if (row.status === 'completed') {
      calls += 1;
      durationMs += asInteger(row.duration_ms as number | string | null | undefined);
      estimatedCostMicrousd += asInteger(
        row.estimated_cost_microusd as number | string | null | undefined,
      );
    }
  }

  return {
    calls,
    minutes: Math.round((durationMs / 60_000) * 100) / 100,
    estimatedCostUsd: Math.round(microusdToUsd(estimatedCostMicrousd) * 1_000_000) / 1_000_000,
    reservedBudgetUsd: Math.round(microusdToUsd(reservedCostMicrousd) * 1_000_000) / 1_000_000,
    internalLimitUsd: microusdToUsd(VOICE_INTERNAL_MONTHLY_CAP_MICROUSD),
  };
}
