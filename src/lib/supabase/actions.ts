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

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
