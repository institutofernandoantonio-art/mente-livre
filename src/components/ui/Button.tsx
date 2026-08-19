import { ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/cn";

type ButtonVariant = "primary" | "secondary" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-brand-600 text-white hover:bg-brand-700 shadow-soft disabled:bg-brand-300",
  secondary:
    "bg-white text-ink border border-mist-200 hover:bg-mist-50 disabled:text-mist-200",
  ghost: "bg-transparent text-ink-soft hover:bg-mist-100 disabled:text-mist-200",
};

const baseButtonClasses =
  "inline-flex items-center justify-center gap-2 rounded-2xl px-6 py-3 text-base font-medium " +
  "transition-colors duration-200 ease-out " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 " +
  "disabled:cursor-not-allowed";

/**
 * Classes visuais de botão, para uso em elementos que não podem ser um
 * <button> (ex.: <Link>, que precisa continuar sendo um <a> por acessibilidade).
 */
export function buttonVariants(variant: ButtonVariant = "primary", className?: string): string {
  return cn(baseButtonClasses, variantClasses[variant], className);
}

/**
 * Botão base do Mente Livre. `loading` desabilita o botão automaticamente
 * para evitar cliques duplicados durante uma requisição (item 29 do briefing).
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", loading = false, disabled, className, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={buttonVariants(variant, className)}
        {...props}
      >
        {loading && (
          <span
            className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
            aria-hidden="true"
          />
        )}
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
