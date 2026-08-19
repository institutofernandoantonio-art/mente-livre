import { ReactNode } from "react";

interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

/** Estado vazio padrão: usado quando ainda não há nada para mostrar. */
export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-mist-200 px-6 py-12 text-center">
      <p className="text-base font-medium text-ink">{title}</p>
      {description && <p className="max-w-sm text-sm text-ink-soft">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
