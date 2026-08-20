// rls_test.mjs
// Teste de isolamento RLS entre dois usuários usando SOMENTE a anon key
// e sessões reais (signInWithPassword). Sem service_role, sem chave secreta,
// sem Table Editor, sem privilégios administrativos.
//
// Execução: npm run test:rls
// Requer as variáveis de ambiente NEXT_PUBLIC_SUPABASE_URL,
// NEXT_PUBLIC_SUPABASE_ANON_KEY, USER_A_EMAIL, USER_A_PASSWORD,
// USER_B_EMAIL, USER_B_PASSWORD — ver docs/SECURITY.md. Nenhum valor
// sensível é impresso.

import { createClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// 1. Leitura de configuração — SOMENTE de variáveis de ambiente locais.
// ---------------------------------------------------------------------------
const NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const USER_A_EMAIL = process.env.USER_A_EMAIL;
const USER_A_PASSWORD = process.env.USER_A_PASSWORD;
const USER_B_EMAIL = process.env.USER_B_EMAIL;
const USER_B_PASSWORD = process.env.USER_B_PASSWORD;

// Validação de presença — sem revelar valores.
const required = {
  NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY,
  USER_A_EMAIL,
  USER_A_PASSWORD,
  USER_B_EMAIL,
  USER_B_PASSWORD,
};
const missing = Object.entries(required)
  .filter(([, v]) => !v)
  .map(([k]) => k);

if (missing.length > 0) {
  console.error('ERRO: variáveis de ambiente ausentes:', missing.join(', '));
  console.error('Defina-as no terminal antes de rodar (ver instruções). Abortando.');
  process.exit(1);
}

// Guarda de segurança: recusa rodar se detectar uma service_role key.
// A anon key tem role "anon"; a service_role tem role "service_role" no payload JWT.
// Checamos o segmento do meio do JWT sem imprimi-lo.
function looksLikeServiceRole(key) {
  try {
    const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64').toString('utf8'));
    return payload.role === 'service_role';
  } catch {
    return false; // se não for um JWT parseável, deixa seguir; não é nosso alvo aqui
  }
}
if (looksLikeServiceRole(NEXT_PUBLIC_SUPABASE_ANON_KEY)) {
  console.error('ERRO: a chave fornecida parece ser service_role. Use a anon/publicável. Abortando.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 2. Utilitários de saída — nunca imprimem credenciais, tokens ou senhas.
// ---------------------------------------------------------------------------
const results = [];
function record(name, pass, detail) {
  results.push({ name, pass });
  const tag = pass ? 'PASS' : 'FAIL';
  console.log(`[${tag}] ${name}${detail ? ' — ' + detail : ''}`);
}

// Sanitiza mensagens de erro para o caso improvável de conterem algo sensível.
function safeErr(error) {
  if (!error) return 'erro desconhecido';
  const msg = (error.message || String(error));
  return msg.replace(/eyJ[A-Za-z0-9_\-\.]+/g, '<jwt-oculto>');
}

// Cria um cliente isolado (sem persistir sessão em disco) e autentica.
async function makeAuthedClient(email, password, label) {
  const client = createClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(`Falha ao autenticar usuário ${label}: ${safeErr(error)}`);
  }
  if (!data?.user?.id) {
    throw new Error(`Autenticação de ${label} não retornou user.id`);
  }
  return { client, id: data.user.id };
}

// ---------------------------------------------------------------------------
// 3. Bloco principal.
// ---------------------------------------------------------------------------
async function main() {
  let A, B;
  try {
    A = await makeAuthedClient(USER_A_EMAIL, USER_A_PASSWORD, 'A');
    B = await makeAuthedClient(USER_B_EMAIL, USER_B_PASSWORD, 'B');
  } catch (e) {
    console.error('ERRO inesperado na autenticação:', safeErr(e));
    process.exit(1);
  }

  console.log(`Usuário A autenticado (id termina em ...${A.id.slice(-4)})`);
  console.log(`Usuário B autenticado (id termina em ...${B.id.slice(-4)})`);
  console.log('---');

  // Direção genérica: "reader" tenta agir sobre "target".
  async function runDirection(reader, target, rLabel, tLabel) {
    // -- Teste: reader lê o PRÓPRIO perfil (espera 1 linha, o próprio id) --
    {
      const { data, error } = await reader.client
        .from('profiles').select('id').eq('id', reader.id);
      if (error) {
        record(`${rLabel} lê o próprio profile`, false, safeErr(error));
      } else {
        const ok = data.length === 1 && data[0].id === reader.id;
        record(`${rLabel} lê o próprio profile`, ok, `linhas=${data.length}`);
      }
    }

    // -- Teste: reader tenta LER o perfil do target (espera []) --
    {
      const { data, error } = await reader.client
        .from('profiles').select('id').eq('id', target.id);
      if (error) {
        // erro de permissão também é aceitável; o proibido é vir dados de target
        record(`${rLabel} NÃO lê profile de ${tLabel}`, true, `bloqueado: ${safeErr(error)}`);
      } else {
        const leaked = data.some((r) => r.id === target.id);
        record(`${rLabel} NÃO lê profile de ${tLabel}`, !leaked, `linhas=${data.length}`);
      }
    }

    // -- Teste: reader tenta ALTERAR o target (espera [] no select pós-update) --
    {
      const { data, error } = await reader.client
        .from('profiles')
        .update({ display_name: 'HACK_' + rLabel })
        .eq('id', target.id)
        .select('id');
      if (error) {
        record(`${rLabel} NÃO altera profile de ${tLabel}`, true, `bloqueado: ${safeErr(error)}`);
      } else {
        const changed = data.length > 0;
        record(`${rLabel} NÃO altera profile de ${tLabel}`, !changed,
          changed ? `ALTEROU linhas=${data.length}` : 'linhas=0');
      }
    }

    // -- Teste: reader tenta EXCLUIR o target (espera [] no select pós-delete) --
    {
      const { data, error } = await reader.client
        .from('profiles').delete().eq('id', target.id).select('id');
      if (error) {
        record(`${rLabel} NÃO exclui profile de ${tLabel}`, true, `bloqueado: ${safeErr(error)}`);
      } else {
        const deleted = data.length > 0;
        if (deleted) {
          // FALHA CRÍTICA: recuperação automática.
          record(`${rLabel} NÃO exclui profile de ${tLabel}`, false,
            `EXCLUIU linhas=${data.length} — iniciando recuperação`);
          await recoverDeleted(target, tLabel);
        } else {
          record(`${rLabel} NÃO exclui profile de ${tLabel}`, true, 'linhas=0');
        }
      }
    }
  }

  // Recuperação: confirma pela sessão do próprio target que sumiu, recria e revalida.
  async function recoverDeleted(target, tLabel) {
    const { data: check } = await target.client
      .from('profiles').select('id').eq('id', target.id);
    const gone = !check || check.length === 0;
    console.log(`   [recuperação] ${tLabel} confirmou desaparecimento: ${gone ? 'sim' : 'não'}`);

    const { error: insErr } = await target.client
      .from('profiles').insert({ id: target.id });
    if (insErr) {
      console.error(`   [recuperação] FALHA ao recriar profile de ${tLabel}:`, safeErr(insErr));
    } else {
      const { data: after } = await target.client
        .from('profiles').select('id').eq('id', target.id);
      const restored = after && after.length === 1;
      console.log(`   [recuperação] profile de ${tLabel} recriado: ${restored ? 'sim' : 'não'}`);
    }
  }

  // Executa as duas direções.
  await runDirection(A, B, 'A', 'B');
  await runDirection(B, A, 'B', 'A');

  // -- Teste 6: cada um atualiza o PRÓPRIO display_name (espera sucesso) --
  async function selfUpdate(u, label) {
    const { data, error } = await u.client
      .from('profiles')
      .update({ display_name: 'self_' + label })
      .eq('id', u.id)
      .select('id');
    const ok = !error && data && data.length === 1;
    record(`${label} atualiza o próprio display_name`, ok,
      error ? safeErr(error) : `linhas=${data.length}`);
  }
  await selfUpdate(A, 'A');
  await selfUpdate(B, 'B');

  // -- Limpeza: restaura display_name para null nos dois próprios perfis --
  async function restoreNull(u, label) {
    const { error } = await u.client
      .from('profiles').update({ display_name: null }).eq('id', u.id);
    console.log(`   [limpeza] display_name de ${label} restaurado para null: ${error ? 'falhou' : 'ok'}`);
  }
  await restoreNull(A, 'A');
  await restoreNull(B, 'B');

  // -- Confirmação final: os dois profiles continuam existindo --
  {
    const { data: aExists } = await A.client.from('profiles').select('id').eq('id', A.id);
    const { data: bExists } = await B.client.from('profiles').select('id').eq('id', B.id);
    const bothOk = aExists?.length === 1 && bExists?.length === 1;
    record('Ambos os profiles continuam existindo', bothOk,
      `A=${aExists?.length ?? 0}, B=${bExists?.length ?? 0}`);
  }

  // -- Resumo --
  console.log('---');
  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  console.log(`RESUMO: ${passed} PASS, ${failed} FAIL, total ${results.length}`);
  process.exit(failed > 0 ? 2 : 0);
}

main().catch((e) => {
  console.error('ERRO inesperado — teste interrompido:', safeErr(e));
  process.exit(1);
});
