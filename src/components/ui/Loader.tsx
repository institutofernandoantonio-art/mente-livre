interface LoaderProps {
  label?: string;
}

/** Estado de carregamento padrão, usado sempre que algo está processando. */
export function Loader({ label = "Carregando..." }: LoaderProps) {
  return (
    <div role="status" className="flex flex-col items-center gap-3 py-10 text-ink-soft">
      <span
        className="h-8 w-8 animate-spin rounded-full border-2 border-brand-300 border-t-brand-600"
        aria-hidden="true"
      />
      <p className="text-sm">{label}</p>
    </div>
  );
}
