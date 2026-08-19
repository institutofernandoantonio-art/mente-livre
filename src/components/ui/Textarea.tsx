import { TextareaHTMLAttributes, forwardRef, useId } from "react";
import { cn } from "@/lib/cn";

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  error?: string;
}

/** Área de texto com label e erro sempre visíveis, para acessibilidade. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, id, className, ...props }, ref) => {
    const generatedId = useId();
    const textareaId = id ?? generatedId;
    const errorId = `${textareaId}-error`;

    return (
      <div className="flex flex-col gap-1.5">
        <label htmlFor={textareaId} className="text-sm font-medium text-ink-soft">
          {label}
        </label>
        <textarea
          ref={ref}
          id={textareaId}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error ? errorId : undefined}
          className={cn(
            "min-h-32 rounded-xl border border-mist-200 bg-white px-4 py-3 text-base text-ink",
            "placeholder:text-mist-200/80 resize-y",
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

Textarea.displayName = "Textarea";
