'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';

type FocusTimerProps = {
  taskTitle: string;
  disabled?: boolean;
  onDone: () => void;
};

function formatRemaining(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function FocusTimer({ taskTitle, disabled = false, onDone }: FocusTimerProps) {
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    if (endsAt === null) return;
    const targetEndsAt = endsAt;

    function updateRemaining() {
      const next = Math.max(0, Math.ceil((targetEndsAt - Date.now()) / 1000));
      setRemainingSeconds(next);
      if (next === 0) {
        setEndsAt(null);
        setFinished(true);
      }
    }

    updateRemaining();
    const interval = window.setInterval(updateRemaining, 1000);
    return () => window.clearInterval(interval);
  }, [endsAt]);

  function start(minutes: 25 | 50) {
    setFinished(false);
    setRemainingSeconds(minutes * 60);
    setEndsAt(Date.now() + minutes * 60_000);
  }

  function stop() {
    setEndsAt(null);
    setRemainingSeconds(0);
    setFinished(false);
  }

  if (finished) {
    return (
      <div className="mt-3 rounded-xl border border-mist-200 p-3" aria-live="polite">
        <p className="font-medium text-ink">Tempo de foco concluído.</p>
        <p className="mt-1 text-sm text-ink-soft">Concluiu “{taskTitle}”?</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" variant="primary" disabled={disabled} onClick={onDone}>
            Feito
          </Button>
          <Button type="button" variant="secondary" disabled={disabled} onClick={() => start(25)}>
            +25 min
          </Button>
          <Button type="button" variant="ghost" disabled={disabled} onClick={stop}>
            Encerrar
          </Button>
        </div>
      </div>
    );
  }

  if (endsAt !== null) {
    return (
      <div className="mt-3 rounded-xl border border-mist-200 p-3" aria-live="polite">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-soft">Foco em andamento</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">{formatRemaining(remainingSeconds)}</p>
        <p className="mt-1 text-sm text-ink-soft">{taskTitle}</p>
        <Button type="button" variant="ghost" disabled={disabled} onClick={stop} className="mt-3 px-3 py-2 text-sm">
          Parar
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="secondary" disabled={disabled} onClick={() => start(25)} className="px-3 py-2 text-sm">
        Foco 25 min
      </Button>
      <Button type="button" variant="ghost" disabled={disabled} onClick={() => start(50)} className="px-3 py-2 text-sm">
        50 min
      </Button>
    </div>
  );
}
