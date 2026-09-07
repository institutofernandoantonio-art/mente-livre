'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { getTodaySummary, type TodaySummaryResult } from './actions';

type ViewState = TodaySummaryResult | { status: 'loading' };

export function TodaySummary() {
  const [state, setState] = useState<ViewState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    getTodaySummary(timeZone).then((result) => {
      if (active) setState(result);
    });

    return () => {
      active = false;
    };
  }, []);

  if (state.status === 'loading') {
    return <p className="text-sm text-ink-soft">Carregando seu resumo...</p>;
  }

  if (state.status === 'error') {
    return <ErrorState message="Não foi possível carregar seu resumo agora." />;
  }

  if (state.total === 0) {
    return <EmptyState title="Nenhuma tarefa concluída hoje ainda." />;
  }

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-ink-soft">Concluídas hoje</p>
        <p className="mt-1 text-3xl font-semibold text-ink">{state.total}</p>
      </div>

      <ol className="flex flex-col gap-3">
        {state.items.map((item) => (
          <li key={item.id} className="rounded-xl border border-mist-200 p-4">
            <p className="font-medium text-ink">{item.title}</p>
            <p className="mt-1 text-xs text-ink-soft">
              {new Intl.DateTimeFormat('pt-BR', {
                hour: '2-digit',
                minute: '2-digit',
                timeZone: state.timeZone,
              }).format(new Date(item.completedAt))}
            </p>
          </li>
        ))}
      </ol>

      {state.total > state.items.length && (
        <p className="text-xs text-ink-soft">Mostrando as 10 conclusões mais recentes.</p>
      )}
    </Card>
  );
}
