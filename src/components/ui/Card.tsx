import { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type CardProps = HTMLAttributes<HTMLDivElement>;

/** Cartão base: cantos arredondados e sombra suave, usado em toda a interface. */
export function Card({ className, ...props }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-mist-200 bg-white p-6 shadow-soft",
        className
      )}
      {...props}
    />
  );
}
