// web/components/reseller-shell.tsx
// Shell dedicado al panel reseller. No toca AppShell (respeta coordinación con
// el otro agente). Copia la estructura visual pero con nav reseller-específica.

import { BarChart3, CreditCard, Home, Link2, Settings, Users } from "lucide-react";
import Link from "next/link";
import type { Session } from "next-auth";
import { Badge } from "./ui/badge";

type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string }> };

const RESELLER_NAV: NavItem[] = [
  { href: "/reseller", label: "Resumen", icon: Home },
  { href: "/reseller/tenants", label: "Tenants", icon: Users },
  { href: "/reseller/commissions", label: "Comisiones", icon: BarChart3 },
  { href: "/reseller/payouts", label: "Payouts", icon: CreditCard },
  { href: "/reseller/settings", label: "Ajustes", icon: Settings },
];

export function ResellerShell({
  session,
  resellerStatus,
  children,
}: {
  session: Session;
  resellerStatus?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-surface-subtle">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
          <Link href="/reseller" className="flex items-center gap-2 text-base font-semibold">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-brand-600 to-accent-pink text-white text-xs">
              O
            </span>
            Ordy Chat
            <span className="ml-2 rounded-md bg-neutral-100 px-2 py-0.5 text-xs font-normal text-neutral-600">
              Partner
            </span>
          </Link>
          <div className="flex items-center gap-3 text-sm">
            {resellerStatus === "pending" ? (
              <Badge tone="warn">Cuenta pendiente</Badge>
            ) : resellerStatus === "paused" ? (
              <Badge tone="warn">Pausado</Badge>
            ) : resellerStatus === "terminated" ? (
              <Badge tone="muted">Terminado</Badge>
            ) : resellerStatus === "active" ? (
              <Badge tone="success">Activo</Badge>
            ) : null}
            <form action="/api/auth/signout" method="post">
              <button className="text-neutral-500 hover:text-neutral-900">Salir</button>
            </form>
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-7xl grid-cols-[220px_1fr] gap-8 px-6 py-8">
        <aside className="space-y-1">
          {RESELLER_NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-neutral-700 hover:bg-white hover:text-neutral-900"
            >
              <Icon className="h-4 w-4 text-neutral-400" />
              {label}
            </Link>
          ))}
        </aside>
        <main>{children}</main>
      </div>
      <footer className="mx-auto max-w-7xl px-6 py-6 text-xs text-neutral-400">
        <Link2 className="mr-1 inline-block h-3 w-3" />
        Programa de partners de Ordy Chat — powered by Ordy SL.
      </footer>
    </div>
  );
}
