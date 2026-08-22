'use client';

import { useActionState } from 'react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { updatePassword, type UpdatePasswordState } from '@/lib/supabase/actions';

const initialState: UpdatePasswordState = { error: null };

export function ResetPasswordForm() {
  const [state, formAction, pending] = useActionState(updatePassword, initialState);

  return (
    <form action={formAction} className="flex w-full flex-col gap-4">
      <Input
        label="Nova senha"
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
        Atualizar senha
      </Button>
    </form>
  );
}
