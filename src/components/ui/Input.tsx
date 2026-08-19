import { InputHTMLAttributes, forwardRef, useId } from "react";
import { cn } from "@/lib/cn";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

/** Campo de texto com label e erro sempre visíveis, para acessibilidade. */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, id, className, ...props }, ref) => {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const errorId = `${inputId}-error`;

    return (
      <div className="flex flex-col gap-1.5">
        <label htmlFor={inputId} className="text-sm font-medium text-ink-soft">
          {label}
        </label>
        <input
          ref={ref}
          id={inputId}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error ? errorId : undefined}
          className={cn(
            "rounded-xl border border-mist-200 bg-white px-4 py-3 text-base text-ink",
            "placeholder:text-mist-200/80",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400",
            error && "border-alert-500 focus-visible:ring-alert-500",
            className
          )}
          {...props}
        />
        {error && (
          <p id={errorId} className="text-sm text-alert-500">
            {error}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = "Input";
