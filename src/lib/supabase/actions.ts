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
