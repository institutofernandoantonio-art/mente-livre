import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function source(relative) {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
}

const route = source('../../src/app/api/voice/transcribe/route.ts');
const provider = source('../../src/lib/voice/openai-stt-provider.ts');
const factory = source('../../src/lib/voice/stt.ts');
const usage = source('../../src/lib/voice/usage.ts');
const limits = source('../../src/lib/voice/limits.ts');
const migration = source('../../supabase/migrations/20260906213000_create_voice_transcription_usage.sql');

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push(true);
    console.log(`[PASS] ${name}`);
  } catch (error) {
    results.push(false);
    console.log(`[FAIL] ${name} — ${error.message}`);
  }
}

check('modelo e preço do MVP estão fixos e revisáveis', () => {
  assert.match(provider, /const OPENAI_STT_MODEL = 'gpt-transcribe'/);
  assert.match(limits, /GPT_TRANSCRIBE_PRICE_MICROUSD_PER_MINUTE = 4_500/);
  assert.ok(!provider.includes('process.env.MENTE_LIVRE_OPENAI_STT_MODEL'));
});

check('chave OpenAI é dedicada e só existe no servidor', () => {
  assert.match(provider, /process\.env\.MENTE_LIVRE_OPENAI_STT_API_KEY/);
  assert.match(provider, /https:\/\/api\.openai\.com\/v1\/audio\/transcriptions/);
  assert.ok(!route.includes('NEXT_PUBLIC_OPENAI'));
  assert.ok(!provider.includes('NEXT_PUBLIC_OPENAI'));
});

check('diagnóstico do provider expõe só categoria e status, nunca corpo de erro', () => {
  assert.match(provider, /categoryFromStatus\(status: number\)/);
  assert.match(provider, /response\.status/);
  assert.match(provider, /VoiceSttProviderError/);
  assert.match(provider, /isVoiceSttProviderError/);
  assert.match(provider, /'timeout'/);
  assert.match(provider, /'network'/);
  assert.match(provider, /'invalid_response'/);
  assert.match(provider, /'empty_transcript'/);
  assert.ok(!provider.includes('await response.text()'));
  assert.ok(!provider.includes('response.headers'));
  assert.ok(!route.includes('response.text()'));
  assert.match(route, /provider_unauthorized/);
  assert.match(route, /provider_forbidden/);
  assert.match(route, /provider_rate_limited/);
  assert.match(route, /provider_bad_request/);
  assert.match(route, /provider_timeout/);
  assert.match(route, /provider_network/);
  assert.match(route, /provider_invalid_response/);
  assert.match(route, /provider_empty_transcript/);
});

check('configuração do provider falha antes da reserva financeira', () => {
  assert.match(provider, /constructor\(\) \{[\s\S]*?getApiKey\(\);[\s\S]*?\}/);
  const providerIndex = route.indexOf('provider = getSpeechToTextProvider()');
  const reserveIndex = route.indexOf('await reserveVoiceUsage');
  assert.ok(providerIndex >= 0);
  assert.ok(reserveIndex > providerIndex);
});

check('feature é fail-closed e provider é desacoplado', () => {
  assert.match(factory, /MENTE_LIVRE_STT_ENABLED === 'true'/);
  assert.match(factory, /MENTE_LIVRE_STT_PROVIDER/);
  assert.match(factory, /case 'openai'/);
  assert.match(factory, /Unsupported voice transcription provider/);
});

check('rota autentica e valida áudio antes de chamar o provider', () => {
  const authIndex = route.indexOf('await supabase.auth.getClaims()');
  const validationIndex = route.indexOf('VOICE_MAX_AUDIO_BYTES');
  const reserveIndex = route.indexOf('await reserveVoiceUsage');
  const transcribeIndex = route.indexOf('await provider.transcribe');
  assert.ok(authIndex >= 0);
  assert.ok(validationIndex >= 0);
  assert.ok(reserveIndex > authIndex);
  assert.ok(transcribeIndex > reserveIndex);
  assert.match(route, /VOICE_MAX_DURATION_MS/);
  assert.match(route, /unsupported_audio/);
});

check('respostas de transcrição nunca são cacheadas', () => {
  assert.match(route, /const NO_STORE_HEADERS = \{ 'Cache-Control': 'no-store' \} as const/);
  assert.match(route, /NextResponse\.json\(\{ error: message, code \}, \{ status, headers: NO_STORE_HEADERS \}\)/);
  assert.match(route, /NextResponse\.json\(\{ text: result\.text, usage \}, \{ headers: NO_STORE_HEADERS \}\)/);
});

check('teto é reservado antes de qualquer chamada paga e finalizado depois', () => {
  assert.match(route, /budget_exceeded/);
  assert.match(route, /rate_limited/);
  assert.match(route, /duplicate/);
  assert.match(route, /await finalizeVoiceUsage/);
});

check('fronteira de reserva não aceita provider, modelo ou preço do chamador', () => {
  assert.match(usage, /reserveVoiceUsage\(input: \{\s*requestId: string;\s*\}\)/);
  assert.match(usage, /supabase\.rpc\('reserve_voice_transcription_usage', \{\s*p_request_id: input\.requestId,?\s*\}\)/);
  assert.ok(!/p_provider\s*:/.test(usage));
  assert.ok(!/p_model\s*:/.test(usage));
  assert.ok(!/p_reserved_cost_microusd\s*:/.test(usage));
  assert.match(route, /reserveVoiceUsage\(\{ requestId \}\)/);
});

check('migration aplica hard cap GLOBAL interno de US$ 4 de forma atômica', () => {
  assert.match(migration, /v_internal_monthly_cap constant bigint := 4000000/);
  assert.match(migration, /v_reserved_cost constant bigint := 1500/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /mente-livre-voice:/);
  assert.match(migration, /v_month_reserved \+ v_reserved_cost > v_internal_monthly_cap/);
  assert.match(migration, /v_recent_count >= 6/);
  assert.match(migration, /unique \(user_id, request_id\)/i);

  const globalSum = /select coalesce\(sum\(v\.reserved_cost_microusd\), 0\)[\s\S]*?where v\.created_at >= v_month_start[\s\S]*?and v\.created_at < v_month_start \+ interval '1 month'/i;
  assert.match(migration, globalSum);
});

check('RPCs privilegiadas ficam em private e wrappers públicos são invoker', () => {
  assert.match(migration, /create schema if not exists private/);
  assert.match(migration, /create or replace function private\.reserve_voice_transcription_usage/);
  assert.match(migration, /create or replace function private\.finalize_voice_transcription_usage/);
  assert.match(migration, /create or replace function public\.reserve_voice_transcription_usage[\s\S]*?security invoker/);
  assert.match(migration, /create or replace function public\.finalize_voice_transcription_usage[\s\S]*?security invoker/);
  assert.match(migration, /security definer/);
  assert.match(migration, /set search_path = ''/);
});

check('tabela não armazena áudio nem transcript e tem RLS explícita', () => {
  assert.match(migration, /alter table public\.voice_transcription_usage enable row level security/);
  assert.match(migration, /for select/);
  assert.match(migration, /for insert/);
  assert.match(migration, /for update/);
  assert.match(migration, /for delete/);
  assert.ok(!/\baudio\s+(bytea|text|jsonb)/i.test(migration));
  assert.ok(!/\btranscript\s+(text|jsonb)/i.test(migration));
});

check('uso mensal calcula apenas metadados mínimos', () => {
  assert.match(usage, /\.select\('status,duration_ms,estimated_cost_microusd,reserved_cost_microusd'\)/);
  assert.ok(!/\.select\([^)]*\braw_text\b/i.test(usage));
  assert.ok(!/\.select\([^)]*\btranscript\b/i.test(usage));
  assert.ok(!/\.select\([^)]*\baudio\b/i.test(usage));
});

check('nenhum arquivo do backend de voz faz log do conteúdo', () => {
  for (const candidate of [route, provider, usage]) {
    assert.ok(!candidate.includes('console.log'));
    assert.ok(!candidate.includes('console.error'));
  }
});

const passed = results.filter(Boolean).length;
const failed = results.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${results.length} total)`);
if (failed > 0) process.exit(1);
