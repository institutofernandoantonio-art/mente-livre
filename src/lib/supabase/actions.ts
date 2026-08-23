'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { createClient } from './server';

export type LoginState = {
  error: string | null;
};

export type SignupState = {
  error: string | null;
  checkEmail: boolean;
};

export type ForgotPasswordState = {
  error: string | null;
  sent: boolean;
};

export type UpdatePasswordState = {
  error: string | null;
};

export type EnrollMfaState = {
  error: string | null;
  factorId: string | null;
  qrCode: string | null;
  secret: string | null;
};

export type ConfirmMfaEnrollmentState = {
  error: string | null;
};

export type VerifyMfaChallengeState = {
  error: string | null;
};

// Allow-list fechada de destinos pós-MFA: nunca um valor arbitrário vindo
// da query string — só escolhe entre as duas rotas que já exigem AAL2.
const MFA_NEXT_ALLOWED_PATHS = new Set(['/entrada', '/redefinir-senha']);

export type CreateBrainDumpState = {
  error: string | null;
  success: boolean;
  brainDumpId: string | null;
};

const RAW_TEXT_MAX_LENGTH = 10000;

export type OrganizedItem = {
  category: string;
  title: string;
  description: string | null;
  priority: string | null;
  priorityReason: string | null;
};

const ITEM_CATEGORIES = new Set(['tarefa', 'compromisso', 'ideia', 'lembrete', 'outro']);
const ITEM_PRIORITIES = new Set(['alta', 'média', 'baixa']);
const ITEM_TITLE_MAX_LENGTH = 200;
const ITEM_DESCRIPTION_MAX_LENGTH = 500;
const PRIORITY_REASON_MAX_LENGTH = 160;

const ORGANIZE_SYSTEM_PROMPT = `Você categoriza um pensamento curto de um usuário em uma sugestão estruturada para um app de produtividade. Responda SOMENTE com um objeto JSON válido, sem nenhum texto antes ou depois, exatamente neste formato:
{"category":"tarefa|compromisso|ideia|lembrete|outro","title":"...","description":"..." ou null,"priority":"alta|média|baixa" ou null,"priority_reason":"..." ou null}

Regras:
- "category": escolha a que melhor descreve o pensamento, só entre os valores listados.
- "title": título curto e claro, poucas palavras.
- "description": só preencha se agregar algo além do título; senão, null.

Para "priority" e "priority_reason", use como referência interna a lógica da Matriz de Eisenhower (importância x urgência), mas NUNCA devolva quadrante — só o nível de prioridade. Considere: prazo explícito, proximidade temporal, impacto/consequência, compromisso com terceiros, importância declarada pelo usuário, e se dá pra adiar sem problema.
- "alta": há base concreta no texto para atenção prioritária, especialmente prazo próximo, compromisso ou consequência relevante.
- "média": é importante ou merece planejamento, mas não há urgência suficiente para ser "alta".
- "baixa": pode esperar, sem consequência evidente a partir do texto.
- null: não há contexto suficiente no texto para recomendar prioridade com segurança.
- "priority_reason": frase curta (até 160 caracteres) explicando SOMENTE o motivo da prioridade escolhida, rastreável ao texto do usuário; null se "priority" for null.

Nunca invente prazo, urgência, consequência, compromisso com terceiros ou importância que não estejam no texto ou não sejam claramente dedutíveis dele. Não transforme qualquer pensamento em prioridade alta por padrão.`;

export async function login(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const email = formData.get('email');
  const password = formData.get('password');

  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    return { error: 'Preencha email e senha.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Mensagem genérica de propósito: nunca revela se o e-mail existe, se a
    // senha está errada, ou qualquer detalhe da resposta do Supabase/erro.
    return { error: 'Email ou senha inválidos.' };
  }

  redirect('/entrada');
}

export async function signup(_prevState: SignupState, formData: FormData): Promise<SignupState> {
  const email = formData.get('email');
  const password = formData.get('password');

  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    return {
      error: 'Não foi possível criar a conta com esses dados. Verifique o email e a senha e tente novamente.',
      checkEmail: false,
    };
  }

  const origin = (await headers()).get('origin');

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${origin}/auth/callback` },
  });

  if (error) {
    // Mensagem genérica de propósito: nunca revela se o e-mail já está
    // cadastrado, se a senha é fraca, ou qualquer outro detalhe do erro —
    // diferenciar isso permitiria enumerar contas existentes.
    return {
      error: 'Não foi possível criar a conta com esses dados. Verifique o email e a senha e tente novamente.',
      checkEmail: false,
    };
  }

  if (data.session) {
    // Confirmação de e-mail desligada no projeto: signUp() já retornou uma
    // sessão ativa, igual ao login.
    redirect('/entrada');
  }

  // Confirmação de e-mail ligada: conta criada, mas sem sessão ainda — o
  // perfil em public.profiles já foi criado pelo trigger handle_new_user
  // (dispara em auth.users, independente de a sessão existir ou não).
  return { error: null, checkEmail: true };
}

export async function signInWithGoogle() {
  const origin = (await headers()).get('origin');

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${origin}/auth/callback` },
  });

  if (error || !data.url) {
    // Mensagem genérica de propósito, mesmo padrão das demais Server
    // Functions deste arquivo: nunca expõe detalhe do erro do provider.
    redirect('/login');
  }

  redirect(data.url);
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}

export async function requestPasswordReset(
  _prevState: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const email = formData.get('email');

  if (typeof email !== 'string' || !email) {
    return { error: 'Informe um email.', sent: false };
  }

  const origin = (await headers()).get('origin');

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?next=/redefinir-senha`,
  });

  // Mensagem sempre igual, exista ou não o email: resetPasswordForEmail()
  // já não revela isso, e diferenciar aqui permitiria enumerar contas —
  // mesmo princípio já aplicado em login/signup.
  return { error: null, sent: true };
}

export async function updatePassword(
  _prevState: UpdatePasswordState,
  formData: FormData,
): Promise<UpdatePasswordState> {
  const password = formData.get('password');

  if (typeof password !== 'string' || !password) {
    return { error: 'Informe uma senha.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    // Mensagem genérica de propósito, mesmo padrão das demais Server
    // Functions deste arquivo: nunca expõe o detalhe do erro do Supabase.
    return { error: 'Não foi possível atualizar sua senha. Tente novamente ou solicite um novo link.' };
  }

  // Encerra a sessão de recovery criada pelo /auth/callback: o usuário
  // precisa logar de novo com a senha nova, em vez de continuar
  // automaticamente autenticado com a sessão que o link de e-mail abriu.
  await supabase.auth.signOut();
  redirect('/login');
}

// Assinatura (prevState, formData) exigida por useActionState, mesmo sem
// nenhum campo de formulário — o botão de "Configurar autenticador" não
// envia dados, só dispara a Server Function.
/* eslint-disable @typescript-eslint/no-unused-vars */
export async function enrollMfaFactor(
  _prevState: EnrollMfaState,
  _formData: FormData,
): Promise<EnrollMfaState> {
  /* eslint-enable @typescript-eslint/no-unused-vars */
  const supabase = await createClient();

  const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
  if (factorsError) {
    return {
      error: 'Não foi possível iniciar a configuração. Tente novamente.',
      factorId: null,
      qrCode: null,
      secret: null,
    };
  }

  if (factors.totp.length > 0) {
    // Regra de produto do MVP: só 1 TOTP verificado por usuário.
    return {
      error: 'Você já tem um autenticador configurado.',
      factorId: null,
      qrCode: null,
      secret: null,
    };
  }

  // Limpa tentativas de enrollment anteriores abandonadas (TOTP nunca
  // confirmado pelo usuário) antes de criar uma nova — nunca mexe em fator
  // verified. unenroll() de um fator unverified não exige aal2 (a exigência
  // documentada é só para fator verified); falha aqui não bloqueia o fluxo,
  // só segue tentando o enroll novo.
  const abandoned = factors.all.filter(
    (factor) => factor.factor_type === 'totp' && factor.status === 'unverified',
  );
  for (const factor of abandoned) {
    await supabase.auth.mfa.unenroll({ factorId: factor.id });
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: 'Autenticador',
  });

  if (error || !data) {
    return {
      error: 'Não foi possível iniciar a configuração. Tente novamente.',
      factorId: null,
      qrCode: null,
      secret: null,
    };
  }

  return { error: null, factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
}

export async function confirmMfaEnrollment(
  factorId: string,
  _prevState: ConfirmMfaEnrollmentState,
  formData: FormData,
): Promise<ConfirmMfaEnrollmentState> {
  const code = formData.get('code');

  if (typeof code !== 'string' || !code || !factorId) {
    return { error: 'Informe o código do autenticador.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });

  if (error) {
    // Mensagem genérica de propósito, mesmo padrão das demais Server
    // Functions deste arquivo: nunca expõe o detalhe do erro do Supabase.
    return { error: 'Código inválido. Tente novamente.' };
  }

  redirect('/entrada');
}

export async function verifyMfaChallenge(
  factorId: string,
  next: string,
  _prevState: VerifyMfaChallengeState,
  formData: FormData,
): Promise<VerifyMfaChallengeState> {
  const code = formData.get('code');

  if (typeof code !== 'string' || !code || !factorId) {
    return { error: 'Informe o código do autenticador.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });

  if (error) {
    return { error: 'Código inválido. Tente novamente.' };
  }

  const destination = MFA_NEXT_ALLOWED_PATHS.has(next) ? next : '/entrada';
  redirect(destination);
}

export async function createBrainDump(
  _prevState: CreateBrainDumpState,
  formData: FormData,
): Promise<CreateBrainDumpState> {
  const rawText = formData.get('raw_text');

  if (typeof rawText !== 'string' || rawText.trim().length === 0) {
    return { error: 'Escreva alguma coisa antes de salvar.', success: false, brainDumpId: null };
  }

  // Array.from() conta por code point, igual ao char_length() do Postgres
  // usado na constraint do banco — rawText.length (UTF-16) divergiria para
  // emoji fora do BMP.
  if (Array.from(rawText).length > RAW_TEXT_MAX_LENGTH) {
    return {
      error: 'O texto pode ter no máximo 10.000 caracteres.',
      success: false,
      brainDumpId: null,
    };
  }

  const supabase = await createClient();

  // user_id nunca vem do formulário — só de claims verificadas no servidor.
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims.sub;

  if (!userId) {
    return {
      error: 'Sessão expirada. Atualize a página e tente novamente.',
      success: false,
      brainDumpId: null,
    };
  }

  const { data: inserted, error } = await supabase
    .from('brain_dumps')
    .insert({
      user_id: userId,
      raw_text: rawText,
      source: 'text', // literal no servidor, nunca do formulário
    })
    .select('id')
    .single();

  if (error || !inserted) {
    // Mensagem genérica de propósito, mesmo padrão das demais Server
    // Functions deste arquivo: nunca expõe o detalhe do erro do Supabase.
    return { error: 'Não foi possível salvar. Tente novamente.', success: false, brainDumpId: null };
  }

  // O pensamento já está salvo aqui — a organização por IA (chamada em
  // seguida, pelo cliente, via organizeBrainDump) é uma etapa independente.
  // Se ela falhar depois, o brain_dump já persistido não é afetado.
  return { error: null, success: true, brainDumpId: inserted.id };
}

function parseOrganizedItem(text: string): OrganizedItem | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }

  const { category, title, description, priority, priority_reason: priorityReasonRaw } =
    parsed as Record<string, unknown>;

  if (typeof category !== 'string' || !ITEM_CATEGORIES.has(category)) {
    return null;
  }

  if (
    typeof title !== 'string' ||
    title.trim().length === 0 ||
    Array.from(title).length > ITEM_TITLE_MAX_LENGTH
  ) {
    return null;
  }

  if (
    description !== null &&
    description !== undefined &&
    (typeof description !== 'string' || Array.from(description).length > ITEM_DESCRIPTION_MAX_LENGTH)
  ) {
    return null;
  }

  if (priority !== null && priority !== undefined) {
    if (typeof priority !== 'string' || !ITEM_PRIORITIES.has(priority)) {
      return null;
    }
  }

  let priorityReason: string | null = null;
  if (priorityReasonRaw !== null && priorityReasonRaw !== undefined) {
    if (typeof priorityReasonRaw !== 'string') {
      return null;
    }
    const trimmed = priorityReasonRaw.trim();
    if (trimmed.length === 0) {
      priorityReason = null;
    } else if (Array.from(trimmed).length > PRIORITY_REASON_MAX_LENGTH) {
      return null;
    } else {
      priorityReason = trimmed;
    }
  }

  return {
    category,
    title,
    description: typeof description === 'string' ? description : null,
    priority: typeof priority === 'string' ? priority : null,
    priorityReason,
  };
}

async function callAnthropicToOrganize(rawText: string): Promise<OrganizedItem | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return null;
  }

  let response: Response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-5',
        max_tokens: 500,
        output_config: { effort: 'low' },
        system: ORGANIZE_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: rawText }],
      }),
    });
  } catch {
    // Falha de rede/timeout ao chamar a Anthropic — tratada como falha
    // suave, nunca propagada como erro técnico ao usuário.
    return null;
  }

  if (!response.ok) {
    return null;
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return null;
  }

  if (typeof payload !== 'object' || payload === null || !('content' in payload)) {
    return null;
  }

  const content = (payload as { content: unknown }).content;
  if (!Array.isArray(content)) {
    return null;
  }

  const textBlock = content.find(
    (block): block is { type: 'text'; text: string } =>
      typeof block === 'object' &&
      block !== null &&
      (block as { type?: unknown }).type === 'text' &&
      typeof (block as { text?: unknown }).text === 'string',
  );

  if (!textBlock) {
    return null;
  }

  // Nunca confia na resposta bruta da IA — só o que passar em
  // parseOrganizedItem() (JSON válido + valores dentro do permitido) chega
  // a ser persistido ou devolvido ao cliente.
  return parseOrganizedItem(textBlock.text.trim());
}

export async function organizeBrainDump(brainDumpId: string): Promise<OrganizedItem | null> {
  if (typeof brainDumpId !== 'string' || !brainDumpId) {
    return null;
  }

  const supabase = await createClient();

  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims.sub;
  if (!userId) {
    return null;
  }

  // RLS já garante que só o dono enxerga a linha — se não vier nada, trata
  // como falha genérica, sem diferenciar "não existe" de "não é seu".
  const { data: brainDump, error: brainDumpError } = await supabase
    .from('brain_dumps')
    .select('raw_text')
    .eq('id', brainDumpId)
    .single();

  if (brainDumpError || !brainDump) {
    return null;
  }

  const suggestion = await callAnthropicToOrganize(brainDump.raw_text);
  if (!suggestion) {
    return null;
  }

  const { error: insertError } = await supabase.from('items').insert({
    user_id: userId,
    brain_dump_id: brainDumpId,
    category: suggestion.category,
    title: suggestion.title,
    description: suggestion.description,
    priority: suggestion.priority,
    needs_confirmation: true,
  });

  if (insertError) {
    // unique(brain_dump_id) pode disparar em corridas/repetições — trata
    // como qualquer outra falha, sem duplicar nem expor detalhe.
    return null;
  }

  return suggestion;
}
