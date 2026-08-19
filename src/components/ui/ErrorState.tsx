import { Button } from "@/components/ui/Button";

interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
}

/**
 * Estado de erro padrão. A mensagem é sempre em linguagem simples (item 28
 * do briefing) — nunca expõe detalhes técnicos ao usuário.
 */
export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-2xl border border-alert-500/20 bg-alert-50 px-6 py-8 text-center"
    >
      <p className="text-base text-ink">{message}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          Tentar novamente
        </Button>
      )}
    </div>
  );
}
