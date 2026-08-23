'use client';

import { useActionState } from 'react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import {
  enrollMfaFactor,
  confirmMfaEnrollment,
  type EnrollMfaState,
  type ConfirmMfaEnrollmentState,
} from '@/lib/supabase/actions';

const initialEnrollState: EnrollMfaState = {
  error: null,
  factorId: null,
  qrCode: null,
  secret: null,
};

const initialConfirmState: ConfirmMfaEnrollmentState = { error: null };

export function EnrollMfaForm() {
  const [enrollState, enrollAction, enrollPending] = useActionState(
    enrollMfaFactor,
    initialEnrollState,
  );
  const [confirmState, confirmAction, confirmPending] = useActionState(
    confirmMfaEnrollment.bind(null, enrollState.factorId ?? ''),
    initialConfirmState,
  );

  if (!enrollState.factorId || !enrollState.qrCode) {
    return (
      <form action={enrollAction} className="flex w-full flex-col gap-4">
        <p className="text-sm text-ink-soft">
          Escaneie o QR code com um aplicativo autenticador (Google
          Authenticator, Authy, 1Password etc.) para começar.
        </p>
        {enrollState.error && (
          <p role="alert" className="text-sm text-alert-500">
            {enrollState.error}
          </p>
        )}
        <Button type="submit" variant="primary" loading={enrollPending} className="w-full">
          Configurar autenticador
        </Button>
      </form>
    );
  }

  return (
    <div className="flex w-full flex-col gap-4">
      {/* next/image não otimiza data URIs. mfa.enroll() (GoTrueClient.js,
          _enroll) já devolve qr_code como data URI completa
          (data:image/svg+xml;utf-8,<svg>...) — usar direto, sem prefixo
          nem encodeURIComponent adicional, confirmado em runtime. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={enrollState.qrCode}
        alt="QR code para configurar o autenticador"
        className="mx-auto h-48 w-48"
      />
      <p className="break-all text-center text-xs text-ink-soft">{enrollState.secret}</p>

      <form action={confirmAction} className="flex w-full flex-col gap-4">
        <Input
          label="Código do autenticador"
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          required
        />
        {confirmState.error && (
          <p role="alert" className="text-sm text-alert-500">
            {confirmState.error}
          </p>
        )}
        <Button type="submit" variant="primary" loading={confirmPending} className="w-full">
          Confirmar
        </Button>
      </form>
    </div>
  );
}
