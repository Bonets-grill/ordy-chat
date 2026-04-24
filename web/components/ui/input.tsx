// web/components/ui/input.tsx — Input "Claude Design".
//
// Borde 1px sutil, focus ring 2px brand, error state vía `data-error="true"`.
// Altura 40px (h-10) acompasada con Button md.

import * as React from "react";
import { cn } from "@/lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  /** Marca el input como inválido — borde rose + ring rose en focus. */
  invalid?: boolean;
};

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", invalid, ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      data-invalid={invalid ? "true" : undefined}
      aria-invalid={invalid || undefined}
      className={cn(
        "h-10 w-full rounded-md border border-border-strong bg-white px-3 text-sm text-ink-900 placeholder:text-ink-400",
        "transition-shadow",
        "focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20",
        "disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-surface-subtle",
        "data-[invalid=true]:border-danger data-[invalid=true]:focus:ring-danger/20",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
