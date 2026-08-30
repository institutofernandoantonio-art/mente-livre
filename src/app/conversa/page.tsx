import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { buttonVariants } from '@/components/ui/Button';
import { ConversationPanel } from './ConversationPanel';

/**
 * Rota isolada da UI conversacional mínima — não substitui nem toca em
 * `/entrada`. Server Component fino: só estrutura a página e renderiza o
 * Client Component (`ConversationPanel`); nenhuma lógica conversacional
 * roda aqui.
 */
export default function ConversaPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <Card>
          <ConversationPanel />
        </Card>

        <div className="mt-6 flex flex-col items-center gap-3">
          <Link href="/tarefas" className={buttonVariants('secondary')}>
            Minhas tarefas
          </Link>
          <Link href="/entrada" className={buttonVariants('secondary')}>
            Voltar para entrada
          </Link>
        </div>
      </div>
    </main>
  );
}
