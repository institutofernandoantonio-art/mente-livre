'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Button, buttonVariants } from '@/components/ui/Button';
import { completeTask } from '@/app/tarefas/actions';
import { setTaskPriority, type TaskPriorityInput } from '@/app/tarefas/priority-actions';
import { getTodayChecklist, type TodayChecklistResult } from './checklist-actions';
import { FocusTimer } from './FocusTimer';

type ViewState = TodayChecklistResult | { status: 'loading' };
type FocusRequest = { taskId: string; minutes: 25 | 50 } | null;

type EisenhowerChoice = {
  label: string;
  hint: string;
  priority: TaskPriorityInput;
};

const eisenhowerChoices: EisenhowerChoice[] = [
  { label: 'Fazer hoje', hint: 'Urgente + importante', priority: 'alta' },
  { label: 'Planejar', hint: 'Importante, sem urgência', priority: 'média' },
  { label: 'Delegar', hint: 'Urgente, menos importante', priority: 'baixa' },
  { label: 'Depois', hint: 'Sem urgência agora', priority: null },
];

function priorityLabel(priority: 'alta' | 'média' | 'baixa' | null) {
  if (priority === 'alta') return 'Fazer hoje · urgente + importante';
  if (priority === 'média') return 'Planejar · importante';
  if (priority === 'baixa') return 'Delegar · urgente';
  return null;
}

function readFocusRequest(): FocusRequest {
  const params = new URLSearchParams(window.location.search);
  const taskId = params.get('focusTask')?.trim() ?? '';
  const rawMinutes = params.get('focusMinutes');
  const minutes = rawMinutes === '25' ? 25 : rawMinutes === '50' ? 50 : null;
  if (!taskId || minutes === null) return null;
  return { taskId, minutes };
}

export function TodayChecklist() {
  const [state, setState] = useState<ViewState>({ status: 'loading' });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<FocusRequest>(null);

  useEffect(() => {
    let active = true;
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const requestedFocus = readFocusRequest();

    getTodayChecklist(timeZone).then((result) => {
      if (!active) return;
      if (requestedFocus !== null && result.status === 'ok') {
        const exists = result.items.some((item) => item.id === requestedFocus.taskId);
        if (exists) setFocusRequest(requestedFocus);
        window.history.replaceState(null, '', '/hoje');
      }
      setState(result);
    });

    return () => {
      active = false;
    };
  }, []);

  async function markDone(taskId: string) {
    if (state.status !== 'ok' || busyId !== null) return;

    setBusyId(taskId);
    const result = await completeTask(taskId);
    if (result.status === 'completed') {
      setState({ status: 'ok', items: state.items.filter((item) => item.id !== taskId) });
    } else {
      setState({ status: 'error' });
    }
    setBusyId(null);
  }

  async function classify(taskId: string, priority: TaskPriorityInput) {
    if (state.status !== 'ok' || busyId !== null) return;

    setBusyId(taskId);
    const result = await setTaskPriority(taskId, priority);
    if (result.status === 'updated') {
      setState({
        status: 'ok',
        items: state.items.map((item) => (item.id === taskId ? { ...item, priority } : item)),
      });
    } else {
      setState({ status: 'error' });
    }
    setBusyId(null);
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
        <p className="mt-1 text-sm text-ink-soft">Decida em um toque o que merece sua atenção.</p>
      </div>

      <ul className="flex flex-col gap-3">
        {state.items.map((item) => {
          const label = priorityLabel(item.priority);
          const isBusy = busyId === item.id;
          const autoStartMinutes = focusRequest?.taskId === item.id ? focusRequest.minutes : null;
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
                  disabled={busyId !== null}
                  onClick={() => markDone(item.id)}
                >
                  {isBusy ? 'Salvando...' : 'Feito'}
                </Button>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-mist-200 pt-3">
                <Link
                  href={`/conversa?agendarTask=${encodeURIComponent(item.id)}`}
                  className={buttonVariants('secondary', 'px-3 py-2 text-sm')}
                >
                  Agendar horário
                </Link>
                <FocusTimer
                  taskTitle={item.title}
                  disabled={busyId !== null}
                  autoStartMinutes={autoStartMinutes}
                  onDone={() => void markDone(item.id)}
                />
              </div>

              <div className="mt-3 border-t border-mist-200 pt-3">
                <p className="mb-2 text-xs font-medium text-ink-soft">Como tratar?</p>
                <div className="grid grid-cols-2 gap-2">
                  {eisenhowerChoices.map((choice) => (
                    <Button
                      key={choice.label}
                      type="button"
                      variant={item.priority === choice.priority ? 'secondary' : 'ghost'}
                      disabled={busyId !== null}
                      onClick={() => classify(item.id, choice.priority)}
                      className="h-auto flex-col items-start px-3 py-2 text-left"
                    >
                      <span className="text-sm">{choice.label}</span>
                      <span className="text-[11px] font-normal text-ink-soft">{choice.hint}</span>
                    </Button>
                  ))}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
