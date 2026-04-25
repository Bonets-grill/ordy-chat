// web/components/app-shell.tsx — Layout del tenant ("Claude Design").
//
// Cambios visuales clave vs el shell anterior:
//   - Surface cálida (#fafaf9 / #fdfdfc) en lugar de blanco frío.
//   - Sidebar agrupada (Operación · Restaurante · Cuenta) con
//     tipografía 13.5px, hover sutil, item activo con barra brand 2px
//     a la izquierda + fondo cálido.
//   - Header con logo + nombre + chip de plan/trial + acciones a la
//     derecha (notificaciones, super-admin, salir).
//   - Bloque "Plan" en la base de la sidebar con CTA discreto.
//   - PageHeader exportado para títulos de página consistentes
//     (H1 + subtítulo + slot de acciones) — opcional, las páginas
//     que no lo usen siguen funcionando con su propio markup.

import {
  AlertTriangle, BarChart3, BellRing, Bot, BookOpen, CalendarCheck, CalendarX,
  ChefHat, ClipboardList, CreditCard, FileText, FlaskConical, LayoutDashboard,
  Menu, MessageSquareText, Puzzle, QrCode, Settings, Smartphone, Sparkles,
  Truck, Users,
} from "lucide-react";
import Link from "next/link";
import type { Session } from "next-auth";
import { Badge } from "./ui/badge";
import { NotificationsBell } from "./notifications-bell";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  group: "ops" | "rest" | "acc";
};

const NAV: NavItem[] = [
  // Operación — el día a día con clientes.
  { href: "/dashboard",          label: "Resumen",         icon: LayoutDashboard,    group: "ops" },
  { href: "/conversations",      label: "Conversaciones",  icon: MessageSquareText,  group: "ops" },
  { href: "/dashboard/playground", label: "Playground",    icon: FlaskConical,       group: "ops" },
  { href: "/agent",              label: "Mi agente",       icon: Bot,                group: "ops" },
  { href: "/agent/knowledge",    label: "Conocimiento",    icon: BookOpen,           group: "ops" },

  // Restaurante — operativa de servicio.
  { href: "/dashboard/carta",    label: "Carta",           icon: Menu,               group: "rest" },
  { href: "/dashboard/modificadores", label: "Modificadores", icon: Puzzle,         group: "rest" },
  { href: "/dashboard/alergenos", label: "Alérgenos",       icon: AlertTriangle,    group: "rest" },
  { href: "/dashboard/recomendaciones", label: "Recomendaciones", icon: Sparkles,    group: "rest" },
  { href: "/agent/tables",       label: "Mesas y QRs",     icon: QrCode,             group: "rest" },
  { href: "/agent/comandero",    label: "Comandero",       icon: ClipboardList,      group: "rest" },
  { href: "/agent/empleados",    label: "Empleados",       icon: Users,              group: "rest" },
  { href: "/agent/kds",          label: "KDS Cocina & Bar",icon: ChefHat,            group: "rest" },
  { href: "/agent/reservations", label: "Reservas",        icon: CalendarCheck,      group: "rest" },
  { href: "/agent/closed-days",  label: "Días cerrados",   icon: CalendarX,          group: "rest" },
  { href: "/agent/suppliers",    label: "Proveedores",     icon: Truck,              group: "rest" },
  { href: "/dashboard/tpv",      label: "TPV (Stripe Terminal)", icon: Smartphone,   group: "rest" },

  // Cuenta — facturación, fiscal, reportes.
  { href: "/agent/fiscal",       label: "Datos fiscales",  icon: FileText,           group: "acc" },
  { href: "/dashboard/ventas",   label: "Ventas y reportes", icon: BarChart3,        group: "acc" },
  { href: "/agent/reportes-pos", label: "Reportes POS (WA)", icon: BellRing,         group: "acc" },
  { href: "/billing",            label: "Facturación",     icon: CreditCard,         group: "acc" },
];

const GROUP_LABEL: Record<NavItem["group"], string> = {
  ops:  "Operación",
  rest: "Restaurante",
  acc:  "Cuenta",
};

function groupedNav() {
  const groups: Record<NavItem["group"], NavItem[]> = { ops: [], rest: [], acc: [] };
  for (const item of NAV) groups[item.group].push(item);
  return groups;
}

function StatusPill({
  subscriptionStatus,
  trialDaysLeft,
}: {
  subscriptionStatus?: string;
  trialDaysLeft?: number;
}) {
  if (subscriptionStatus === "trialing" && typeof trialDaysLeft === "number") {
    return <Badge tone="warn">Trial · {trialDaysLeft}d</Badge>;
  }
  if (subscriptionStatus === "active") return <Badge tone="success">Activo</Badge>;
  if (subscriptionStatus) return <Badge tone="warn">{subscriptionStatus}</Badge>;
  return null;
}

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
  const groups = groupedNav();
  const userInitial = (session.user.name ?? session.user.email ?? "T")
    .trim()
    .charAt(0)
    .toUpperCase();

  return (
    // Layout app-like: viewport completo, sin scroll global. Sidebar y main
    // tienen cada uno su propio overflow-y-auto, así el sidebar no salta cuando
    // se hace scroll en el contenido (y viceversa).
    <div className="flex h-screen flex-col overflow-hidden bg-surface-subtle text-ink-900">
      {/* Header — fijo arriba por flex-none, sin sticky. */}
      <header className="flex-none border-b border-black/5 bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-6">
          <Link href="/dashboard" className="flex items-center gap-2.5 text-[15px] font-medium tracking-tight">
            <span
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-xs font-semibold text-white shadow-sm"
              style={{ background: "#c96442" }}
              aria-hidden
            >
              O
            </span>
            <span>Ordy Chat</span>
          </Link>

          <div className="flex items-center gap-2 text-sm">
            <StatusPill subscriptionStatus={subscriptionStatus} trialDaysLeft={trialDaysLeft} />
            <NotificationsBell />
            {isAdmin && (
              <Link
                href="/admin"
                className="hidden sm:inline-flex h-8 items-center gap-1.5 rounded-md bg-violet-100 px-2.5 text-[12.5px] font-medium text-violet-700 transition-colors hover:bg-violet-200"
              >
                <Settings className="h-3.5 w-3.5" />
                Super Admin
              </Link>
            )}
            <span
              className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-ink-900 text-[12px] font-medium text-white"
              title={session.user.email ?? ""}
              aria-hidden
            >
              {userInitial}
            </span>
            <form action="/api/auth/signout" method="post">
              <button
                type="submit"
                className="text-[13px] text-ink-500 transition-colors hover:text-ink-900"
              >
                Salir
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* Body — flex-1 min-h-0 es CLAVE para que los hijos puedan tener su
          propio scroll. Sin min-h-0 los flex children heredan min-height:auto
          y desbordan al padre, rompiendo el overflow del viewport. */}
      <div className="mx-auto grid w-full min-h-0 max-w-7xl flex-1 grid-cols-1 gap-8 px-6 lg:grid-cols-[232px_1fr]">
        {/* Sidebar — scroll independiente. Sólo en desktop. */}
        <aside className="hidden lg:flex min-h-0 flex-col gap-6 overflow-y-auto py-8 pr-2">
          {(Object.keys(groups) as Array<NavItem["group"]>).map((g) => (
            <nav key={g} aria-label={GROUP_LABEL[g]}>
              <div className="mb-1.5 px-3 text-[10.5px] font-medium uppercase tracking-wider2 text-ink-500">
                {GROUP_LABEL[g]}
              </div>
              <ul className="space-y-0.5">
                {groups[g].map(({ href, label, icon: Icon }) => (
                  <li key={href}>
                    <Link
                      href={href}
                      className="group relative flex items-center gap-3 rounded-md px-3 py-1.5 text-[13.5px] text-ink-700 transition-colors hover:bg-black/[0.04] hover:text-ink-900 aria-[current=page]:bg-brand-50 aria-[current=page]:text-ink-900"
                    >
                      <Icon className="h-4 w-4 text-ink-400 group-hover:text-ink-700" />
                      <span>{label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}

          {/* Plan / upgrade */}
          <div
            className="mt-2 rounded-xl bg-surface-card p-4 shadow-ringSubtle"
            role="complementary"
            aria-label="Plan actual"
          >
            <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider2 text-ink-500">
              <CreditCard className="h-3.5 w-3.5 text-brand-600" />
              Plan
            </div>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-500">
              {subscriptionStatus === "trialing"
                ? `Trial activo. ${trialDaysLeft ?? 0} días restantes.`
                : subscriptionStatus === "active"
                  ? "Suscripción activa. Gracias por confiar."
                  : "Activa tu suscripción para mantener el agente sin pausas."}
            </p>
            <Link
              href="/billing"
              className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-medium text-brand-600 transition-colors hover:text-brand-700"
            >
              Gestionar plan →
            </Link>
          </div>
        </aside>

        {/* Main — scroll independiente del sidebar. min-w-0 evita que contenido
            ancho (tablas, code blocks) reviente el grid. */}
        <main className="min-h-0 min-w-0 overflow-y-auto py-8">{children}</main>
      </div>
    </div>
  );
}

/**
 * PageHeader — estandariza el bloque H1 + subtítulo + actions en
 * paneles internos. Opcional: las páginas pueden seguir usando su
 * markup actual sin tocarlo. Recomendado para páginas nuevas o cuando
 * se refactoriza alguna existente.
 *
 * Variantes:
 *   - editorial (default): H1 con stack serif Claude — calmado, marca.
 *   - compact: H1 sans-serif, denso — para subpáginas (`/dashboard/turno`).
 */
export function PageHeader({
  title,
  subtitle,
  breadcrumbs,
  actions,
  variant = "editorial",
}: {
  title: string;
  subtitle?: string;
  breadcrumbs?: Array<{ href?: string; label: string }>;
  actions?: React.ReactNode;
  variant?: "editorial" | "compact";
}) {
  return (
    <div className="mb-8">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Migas" className="mb-2 flex items-center gap-1 text-[12.5px] text-ink-500">
          {breadcrumbs.map((b, i) => (
            <span key={i} className="flex items-center gap-1">
              {b.href ? (
                <Link href={b.href} className="hover:text-ink-700">{b.label}</Link>
              ) : (
                <span className="text-ink-700">{b.label}</span>
              )}
              {i < breadcrumbs.length - 1 && <span className="text-ink-400">›</span>}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {variant === "editorial" ? (
            <h1 className="font-serif-editorial text-[28px] leading-[1.15] tracking-tight-h1 text-ink-900">
              {title}
            </h1>
          ) : (
            <h1 className="text-[22px] font-semibold tracking-tight text-ink-900">
              {title}
            </h1>
          )}
          {subtitle && (
            <p className="mt-1 max-w-2xl text-[14px] leading-relaxed text-ink-500">
              {subtitle}
            </p>
          )}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
