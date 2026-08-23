'use client';

import { useActionState, useState, useEffect } from 'react';
import { Textarea } from '@/components/ui/Textarea';
import { Button } from '@/components/ui/Button';
import {
  createBrainDump,
  organizeBrainDump,
  type CreateBrainDumpState,
  type OrganizedItem,
} from '@/lib/supabase/actions';

const initialState: CreateBrainDumpState = { error: null, success: false, brainDumpId: null };

type OrganizeStatus = 'idle' | 'organizing' | 'done' | 'failed';

// Conversão só de apresentação — o banco continua guardando só
// alta/média/baixa/null (ver docs/DECISIONS.md, Fase 5).
const PRIORITY_LABELS: Record<string, string> = {
  alta: 'Fazer primeiro',
  média: 'Planejar',
  baixa: 'Pode esperar',
};

function priorityLabel(priority: string | null): string {
  return (priority && PRIORITY_LABELS[priority]) || 'Precisa de mais contexto';
}

export function BrainDumpForm() {
  const [state, formAction, pending] = useActionState(createBrainDump, initialState);
  const [rawText, setRawText] = useState('');
  const [organizeStatus, setOrganizeStatus] = useState<OrganizeStatus>('idle');
  const [organizedItem, setOrganizedItem] = useState<OrganizedItem | null>(null);

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
      if (state.brainDumpId) {
        setOrganizeStatus('organizing');
        setOrganizedItem(null);
      }
    }
  }

  // Organizar por IA é uma etapa independente do salvamento — dispara
  // automaticamente depois de um brain dump salvo com sucesso. Falha aqui
  // nunca desfaz o salvamento nem mostra erro técnico. O efeito só faz a
  // chamada assíncrona em si; a transição para "organizando" já aconteceu
  // acima, durante a renderização (mesmo motivo do ajuste de rawText).
  useEffect(() => {
    if (!state.success || !state.brainDumpId) {
      return;
    }

    let cancelled = false;
    const brainDumpId = state.brainDumpId;

    organizeBrainDump(brainDumpId).then((item) => {
      if (cancelled) return;
      setOrganizeStatus(item ? 'done' : 'failed');
      setOrganizedItem(item);
    });

    return () => {
      cancelled = true;
    };
  }, [state.success, state.brainDumpId]);

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
          {organizeStatus === 'organizing'
            ? 'Pensamento salvo. Organizando...'
            : organizeStatus === 'failed'
              ? 'Pensamento salvo. Não consegui organizar agora.'
              : 'Pensamento salvo.'}
        </p>
      )}
      {organizedItem && (
        <div className="rounded-xl border border-mist-200 bg-mist-50 p-4 text-sm">
          <p className="font-medium text-ink capitalize">{organizedItem.category}</p>
          <p className="text-ink">{organizedItem.title}</p>
          {organizedItem.description && (
            <p className="mt-1 text-ink-soft">{organizedItem.description}</p>
          )}
          <p className="mt-3 text-sm font-semibold tracking-wide text-ink uppercase">
            {priorityLabel(organizedItem.priority)}
          </p>
          {organizedItem.priorityReason && (
            <p className="mt-1 text-ink-soft">{organizedItem.priorityReason}</p>
          )}
        </div>
      )}
      <Button type="submit" variant="primary" loading={pending} className="w-full">
        Salvar
      </Button>
    </form>
  );
}
