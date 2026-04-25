// web/components/ui/card.tsx — Card "Claude Design".
//
// Filosofía: ring shadow sutil en lugar de border duro. Padding consistente
// (24px). Header con título + acción opcional. Sin sombras agresivas;
// la elevación visible se reserva para popovers y menús.

import * as React from "react";
import { cn } from "@/lib/utils";

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-xl bg-surface-card shadow-ringSubtle transition-shadow",
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = "Card";

export const CardHeader = (props: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    {...props}
    className={cn("flex flex-col gap-1 px-6 pt-6 pb-4", props.className)}
  />
);

export const CardTitle = (props: React.HTMLAttributes<HTMLHeadingElement>) => (
  <h3
    {...props}
    className={cn(
      "text-[15px] font-semibold tracking-tight text-ink-900",
      props.className,
    )}
  />
);

export const CardDescription = (props: React.HTMLAttributes<HTMLParagraphElement>) => (
  <p
    {...props}
    className={cn("text-[13px] text-ink-500", props.className)}
  />
);

export const CardContent = (props: React.HTMLAttributes<HTMLDivElement>) => (
  <div {...props} className={cn("px-6 pb-6", props.className)} />
);

/**
 * CardToolbar — fila opcional al lado del título para meter actions
 * (botones secundarios, filtros, links). Uso:
 *
 *   <Card>
 *     <CardHeader>
 *       <div className="flex items-start justify-between gap-3">
 *         <div>
 *           <CardTitle>Conversaciones</CardTitle>
 *           <CardDescription>Últimas 50</CardDescription>
 *         </div>
 *         <CardToolbar>
 *           <Button size="sm" variant="secondary">Exportar</Button>
 *         </CardToolbar>
 *       </div>
 *     </CardHeader>
 *   </Card>
 */
export const CardToolbar = (props: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    {...props}
    className={cn("flex items-center gap-2", props.className)}
  />
);
