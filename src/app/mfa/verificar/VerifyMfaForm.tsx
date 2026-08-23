'use client';

import { useActionState } from 'react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { verifyMfaChallenge, type VerifyMfaChallengeState } from '@/lib/supabase/actions';

const initialState: VerifyMfaChallengeState = { error: null };

export function VerifyMfaForm({ factorId, next }: { factorId: string; next: string }) {
  const [state, formAction, pending] = useActionState(
    verifyMfaChallenge.bind(null, factorId, next),
    initialState,
  );

  return (
    <form action={formAction} className="flex w-full flex-col gap-4">
      <Input
        label="Código do autenticador"
        name="code"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        required
      />
      {state.error && (
        <p role="alert" className="text-sm text-alert-500">
          {state.error}
        </p>
      )}
      <Button type="submit" variant="primary" loading={pending} className="w-full">
        Verificar
      </Button>
    </form>
  );
}
