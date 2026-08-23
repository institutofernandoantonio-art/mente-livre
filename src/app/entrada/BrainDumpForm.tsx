'use client';

import { useActionState, useState } from 'react';
import { Textarea } from '@/components/ui/Textarea';
import { Button } from '@/components/ui/Button';
import { createBrainDump, type CreateBrainDumpState } from '@/lib/supabase/actions';

const initialState: CreateBrainDumpState = { error: null, success: false };

export function BrainDumpForm() {
  const [state, formAction, pending] = useActionState(createBrainDump, initialState);
  const [rawText, setRawText] = useState('');

  // O React reseta campos NÃO-controlados de um <form action={...}> sempre
  // que a action termina sem lançar exceção — o que inclui qualquer retorno
  // de erro "lógico" nosso (createBrainDump nunca lança). Por isso o campo
  // precisa ser controlado: só nós decidimos limpar, e só no sucesso real.
  // Ajuste feito durante a renderização (não em useEffect) para não disparar
  // uma segunda renderização em cascata — mesmo padrão recomendado pela
  // documentação do React para "resetar estado quando algo muda".
  const [handledState, setHandledState] = useState(state);
  if (state !== handledState) {
    setHandledState(state);
    if (state.success) {
      setRawText('');
    }
  }

  return (
    <form action={formAction} className="flex w-full flex-col gap-4">
      <Textarea
        label="O que está ocupando sua mente?"
        name="raw_text"
        maxLength={10000}
        required
        value={rawText}
        onChange={(event) => setRawText(event.target.value)}
      />
      {state.error && (
        <p role="alert" className="text-sm text-alert-500">
          {state.error}
        </p>
      )}
      {state.success && (
        <p role="status" className="text-sm text-ink-soft">
          Pensamento salvo.
        </p>
      )}
      <Button type="submit" variant="primary" loading={pending} className="w-full">
        Salvar
      </Button>
    </form>
  );
}
