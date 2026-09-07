import { NextResponse } from 'next/server';
import { getVoiceUsageSummary } from '@/lib/voice/usage';

export const runtime = 'nodejs';

export async function GET() {
  const usage = await getVoiceUsageSummary();
  if (usage === null) {
    return NextResponse.json({ error: 'Não foi possível carregar o consumo de voz.' }, { status: 401 });
  }

  return NextResponse.json({ usage }, { headers: { 'Cache-Control': 'no-store' } });
}
