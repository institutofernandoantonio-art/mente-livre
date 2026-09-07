'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Button } from '@/components/ui/Button';
import { completeTask } from '@/app/tarefas/actions';
import { getTodayChecklist, type TodayChecklistResult } from './checklist-actions';

type ViewState = TodayChecklistResult | { status: 'loading' };

function priorityLabel(priority: 'alta' | 'média' | 'baixa' | null) {
  if (priority === 'alta') return 'Alta prioridade';
  if (priority === 'média') return 'Prioridade média';
  if (priority === 'baixa') return 'Prioridade baixa';
  return null;
}

export function TodayChecklist() {
  const [state, setState] = useState<ViewState>({ status: 'loading' });
  const [completingId, setCompletingId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    getTodayChecklist(timeZone).then((result) => {
      if (active) setState(result);
    });

    return () => {
      active = false;
    };
  }, []);

  async function markDone(taskId: string) {
    if (state.status !== 'ok' || completingId !== null) return;

    setCompletingId(taskId);
    const result = await completeTask(taskId);
    if (result.status === 'completed') {
      setState({ status: 'ok', items: state.items.filter((item) => item.id !== taskId) });
    } else {
      setState({ status: 'error' });
    }
    setCompletingId(null);
  }

  if (state.status === 'loading') {
    return <p className="mt-6 text-sm text-ink-soft">Carregando checklist do dia...</p>;
  }

  if (state.status === 'error') {
    return <div className="mt-6"><ErrorState message="Não foi possível carregar seu checklist agora." /></div>;
  }

  if (state.items.length === 0) {
    return (
      <div className="mt-6">
        <EmptyState title="Nenhuma tarefa sem horário para hoje." />
      </div>
    );
  }

  return (
    <Card className="mt-6 flex flex-col gap-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-ink-soft">Checklist do dia</p>
        <h2 className="mt-1 font-semibold text-ink">Para fazer hoje, sem horário marcado</h2>
        <p className="mt-1 text-sm text-ink-soft">Faça no seu ritmo e marque quando concluir.</p>
      </div>

      <ul className="flex flex-col gap-3">
        {state.items.map((item) => {
          const label = priorityLabel(item.priority);
          const isCompleting = completingId === item.id;
          return (
            <li key={item.id} className="rounded-xl border border-mist-200 p-4">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink">{item.title}</p>
                  {label && <p className="mt-1 text-xs font-medium text-ink-soft">{label}</p>}
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={completingId !== null}
                  onClick={() => markDone(item.id)}
                >
                  {isCompleting ? 'Salvando...' : 'Feito'}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
