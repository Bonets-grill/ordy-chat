import { BellRing, Bot, BookOpen, CalendarCheck, CalendarX, ChefHat, CreditCard, FileText, FlaskConical, LayoutDashboard, Menu, MessageSquareText, QrCode, Settings, Truck } from "lucide-react";
import Link from "next/link";
import type { Session } from "next-auth";
import { Badge } from "./ui/badge";
import { NotificationsBell } from "./notifications-bell";

type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string }> };

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Resumen", icon: LayoutDashboard },
  { href: "/conversations", label: "Conversaciones", icon: MessageSquareText },
  { href: "/dashboard/playground", label: "Playground", icon: FlaskConical },
  { href: "/agent", label: "Mi agente", icon: Bot },
  { href: "/agent/knowledge", label: "Conocimiento", icon: BookOpen },
  { href: "/dashboard/carta", label: "Carta", icon: Menu },
  { href: "/agent/tables", label: "Mesas y QRs", icon: QrCode },
  { href: "/agent/kds", label: "KDS Cocina & Bar", icon: ChefHat },
  { href: "/agent/reservations", label: "Reservas", icon: CalendarCheck },
  { href: "/agent/closed-days", label: "Días cerrados", icon: CalendarX },
  { href: "/agent/suppliers", label: "Proveedores", icon: Truck },
  { href: "/agent/fiscal", label: "Datos fiscales", icon: FileText },
  { href: "/agent/reportes-pos", label: "Reportes POS", icon: BellRing },
  { href: "/billing", label: "Facturación", icon: CreditCard },
];

export function AppShell({
  session,
  subscriptionStatus,
  trialDaysLeft,
  children,
}: {
  session: Session;
  subscriptionStatus?: string;
  trialDaysLeft?: number;
  children: React.ReactNode;
}) {
  const isAdmin = session.user.role === "super_admin";

  return (
    <div className="min-h-screen bg-surface-subtle">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
          <Link href="/dashboard" className="flex items-center gap-2 text-base font-semibold">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-brand-600 to-accent-pink text-white text-xs">O</span>
            Ordy Chat
          </Link>
          <div className="flex items-center gap-3 text-sm">
            {subscriptionStatus === "trialing" && typeof trialDaysLeft === "number" ? (
              <Badge tone="warn">Trial — {trialDaysLeft}d restantes</Badge>
            ) : subscriptionStatus === "active" ? (
              <Badge tone="success">Activo</Badge>
            ) : subscriptionStatus ? (
              <Badge tone="warn">{subscriptionStatus}</Badge>
            ) : null}
            <NotificationsBell />
            {isAdmin && (
              <Link href="/admin" className="text-neutral-700 hover:text-neutral-900">
                Admin
              </Link>
            )}
            <form action="/api/auth/signout" method="post">
              <button className="text-neutral-500 hover:text-neutral-900">Salir</button>
            </form>
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-7xl grid-cols-[220px_1fr] gap-8 px-6 py-8">
        <aside className="space-y-1">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-neutral-700 hover:bg-white hover:text-neutral-900"
            >
              <Icon className="h-4 w-4 text-neutral-400" />
              {label}
            </Link>
          ))}
          {isAdmin && (
            <Link href="/admin" className="mt-4 flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-neutral-700 hover:bg-white hover:text-neutral-900">
              <Settings className="h-4 w-4 text-neutral-400" />
              Super Admin
            </Link>
          )}
        </aside>
        <main>{children}</main>
      </div>
    </div>
  );
}
