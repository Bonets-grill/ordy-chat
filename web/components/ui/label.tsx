// web/components/ui/label.tsx — Label "Claude Design".
//
// Variantes:
//  - default: 13px, peso medium, ink-700.
//  - eyebrow: estilo "section caps" — uppercase 11px tracking-wider, color ink-500.
//    Útil para encabezados de campo en formularios largos y bloques de filtros.

"use client";

import * as LabelPrimitive from "@radix-ui/react-label";
import * as React from "react";
import { cn } from "@/lib/utils";

type LabelProps = React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> & {
  eyebrow?: boolean;
};

export const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  LabelProps
>(({ className, eyebrow, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(
      eyebrow
        ? "text-[11px] font-medium uppercase tracking-wider2 text-ink-500"
        : "text-[13px] font-medium leading-none text-ink-700",
      "peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
      className,
    )}
    {...props}
  />
));
Label.displayName = "Label";
