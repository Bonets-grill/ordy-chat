// web/components/ui/empty-state.tsx — primitiva reutilizable para estados
// vacíos en paneles internos (sin datos aún, lista vacía, primer uso).
//
// Filosofía Claude: icono lineal en círculo cálido, título sereno, copy
// breve explicando QUÉ pasa y QUÉ hacer, CTA opcional.
//
// Uso:
//   <EmptyState
//     icon={MessageSquareText}
//     title="Aún no hay conversaciones"
//     description="Conecta tu WhatsApp en Mi agente para empezar."
//     action={<Button asChild variant="brand"><Link href="/agent">Conectar</Link></Button>}
//   />

import * as React from "react";
import { cn } from "@/lib/utils";

type EmptyStateProps = {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
};

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center px-6 py-12",
        className,
      )}
    >
      {Icon ? (
        <div
          className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600"
          aria-hidden
        >
          <Icon className="h-5 w-5" />
        </div>
      ) : null}
      <h3 className="text-[15px] font-semibold tracking-tight text-ink-900">
        {title}
      </h3>
      {description ? (
        <p className="mt-1 max-w-sm text-[13.5px] leading-relaxed text-ink-500">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
