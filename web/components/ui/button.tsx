// web/components/ui/button.tsx — primitives "Claude Design" para paneles.
//
// Variantes:
//   - primary: ink/oscuro sólido — acción principal (CTA del flujo).
//   - brand:   gradient terracotta cálido — destacado de marca.
//   - secondary: superficie blanca con ring sutil — acción secundaria.
//   - ghost:   transparente — acciones de navegación / toolbar.
//   - danger:  rojo — acciones destructivas (borrar, cancelar suscripción).
//
// Tamaños:
//   - sm: 32px alto — denso, toolbars/tabs.
//   - md: 40px alto — default en formularios y CTAs.
//   - lg: 44px alto — hero internos, primer CTA del flujo.
//
// Radius default: rounded-md (6px) — más pro que pill. Pills se
// reservan para chips/badges/toggles. `loading` desactiva + spinner.

import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "@radix-ui/react-slot";
import * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  // base
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium tracking-tight transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:pointer-events-none disabled:opacity-50 select-none",
  {
    variants: {
      variant: {
        primary:
          "bg-ink-900 text-white hover:bg-ink-700 active:bg-ink-900 shadow-sm",
        brand:
          "bg-brand-500 text-white hover:bg-brand-600 active:bg-brand-700 shadow-sm",
        secondary:
          "bg-white text-ink-900 shadow-ringSubtle hover:bg-surface-subtle hover:shadow-ringStrong",
        ghost:
          "bg-transparent text-ink-700 hover:bg-black/5 active:bg-black/10",
        danger:
          "bg-danger text-white hover:bg-danger-600 active:bg-danger-700 shadow-sm",
      },
      size: {
        sm: "h-8 px-3 text-[13px]",
        md: "h-10 px-4",
        lg: "h-11 px-5 text-[15px]",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, loading, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    const isDisabled = disabled || loading;
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={isDisabled}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? (
          <span className="inline-flex items-center gap-2">
            <svg
              className="h-3.5 w-3.5 animate-spin"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
              <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
            {children}
          </span>
        ) : (
          children
        )}
      </Comp>
    );
  },
);
Button.displayName = "Button";

export { buttonVariants };
