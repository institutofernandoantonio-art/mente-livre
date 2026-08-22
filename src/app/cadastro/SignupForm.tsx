'use client';

import { useActionState } from 'react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { signup, type SignupState } from '@/lib/supabase/actions';

const initialState: SignupState = { error: null, checkEmail: false };

export function SignupForm() {
  const [state, formAction, pending] = useActionState(signup, initialState);

  if (state.checkEmail) {
    return (
      <p role="status" className="text-center text-sm text-ink-soft">
        Conta criada. Verifique seu email para confirmar antes de entrar.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex w-full flex-col gap-4">
      <Input
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        required
      />
      <Input
        label="Senha"
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={6}
        required
      />
      {state.error && (
        <p role="alert" className="text-sm text-alert-500">
          {state.error}
        </p>
      )}
      <Button type="submit" variant="primary" loading={pending} className="w-full">
        Criar conta
      </Button>
    </form>
  );
}
