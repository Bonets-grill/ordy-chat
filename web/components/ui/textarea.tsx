// web/components/ui/textarea.tsx — Textarea "Claude Design".
// Mismo patrón que Input — ring focus brand, error state vía data-invalid.

import * as React from "react";
import { cn } from "@/lib/utils";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  invalid?: boolean;
};

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, invalid, ...props }, ref) => (
    <textarea
      ref={ref}
      data-invalid={invalid ? "true" : undefined}
      aria-invalid={invalid || undefined}
      className={cn(
        "w-full rounded-md border border-border-strong bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 leading-relaxed",
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
Textarea.displayName = "Textarea";
