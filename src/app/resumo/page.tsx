import Link from 'next/link';
import { buttonVariants } from '@/components/ui/Button';
import { TodaySummary } from './TodaySummary';

export default function ResumoPage() {
  return (
    <main className="flex flex-1 flex-col items-center px-6 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-soft">Resumo do dia</p>
          <h1 className="mt-1 text-xl font-semibold text-ink">O que você concluiu hoje</h1>
          <p className="mt-2 text-sm text-ink-soft">Um retrato simples do avanço do seu dia.</p>
        </div>

        <TodaySummary />

        <div className="mt-6 flex flex-col items-center gap-3">
          <Link href="/hoje" className={buttonVariants('secondary')}>
            Voltar para Hoje
          </Link>
          <Link href="/tarefas" className={buttonVariants('secondary')}>
            Ver tarefas
          </Link>
        </div>
      </div>
    </main>
  );
}
