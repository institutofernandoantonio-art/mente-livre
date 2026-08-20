'use server';

import { redirect } from 'next/navigation';
import { createClient } from './server';

export type LoginState = {
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

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
