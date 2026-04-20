// web/components/admin-shell.tsx — Layout exclusivo del super-admin.
//
// Estética: inspirada en Claude (Anthropic) — parchment background,
// neutrales warm-toned (yellow-brown undertone), serif para headings,
// terracotta solo para acentos primarios, ring shadows en lugar de
// drop shadows pesados. Editorial, calmado, profesional.
//
// CRÍTICO: NUNCA muestra el nav del tenant aquí. Si estás en /admin/*,
// el sidebar es de admin (Tenants, Validador, Resellers, Payouts...).
// El bug original: AppShell con NAV de tenant en /admin/* hacía click →
// /dashboard → requireTenant() falla → redirect a /onboarding/fast.

import {
  Activity,
  Boxes,
  Briefcase,
  Coins,
  FileKey,
  Flag,
  LayoutDashboard,
  MessageSquare,
  Receipt,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import Link from "next/link";
import type { Session } from "next-auth";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  group?: "core" | "ops" | "biz" | "sys";
};

const NAV: NavItem[] = [
  // CORE
  { href: "/admin", label: "Resumen", icon: LayoutDashboard, group: "core" },
  { href: "/admin/tenants", label: "Tenants", icon: Users, group: "core" },
  { href: "/admin/validator", label: "Validador", icon: ShieldCheck, group: "core" },
  { href: "/admin/learning", label: "Reglas aprendidas", icon: Sparkles, group: "core" },
  { href: "/admin/assistant", label: "Asistente (Opus 4.7)", icon: MessageSquare, group: "core" },
  // OPS
  { href: "/admin/onboarding-jobs", label: "Onboarding jobs", icon: Sparkles, group: "ops" },
  { href: "/admin/instances", label: "Instancias WA", icon: Activity, group: "ops" },
  // BIZ
  { href: "/admin/resellers", label: "Resellers", icon: Briefcase, group: "biz" },
  { href: "/admin/payouts", label: "Payouts", icon: Coins, group: "biz" },
  // SYS
  { href: "/admin/flags", label: "Feature flags", icon: Flag, group: "sys" },
  { href: "/admin/settings", label: "API keys", icon: FileKey, group: "sys" },
];

const GROUP_LABEL: Record<NonNullable<NavItem["group"]>, string> = {
  core: "Operaciones",
  ops: "Pipeline",
  biz: "Negocio",
  sys: "Sistema",
};

function groupedNav() {
  const groups: Record<string, NavItem[]> = {};
  for (const item of NAV) {
    const g = item.group ?? "core";
    (groups[g] ??= []).push(item);
  }
  return groups;
}

export function AdminShell({
  session,
  children,
  /**
   * Para subrayar visualmente el item activo. Se pasa desde la página
   * server, p.ej. activePath="/admin/validator". Si no se pasa, ningún
   * item se ilumina (no es crítico — la URL ya da contexto).
   */
  activePath,
}: {
  session: Session;
  children: React.ReactNode;
  activePath?: string;
}) {
  const groups = groupedNav();
  const userInitial = (session.user.name ?? session.user.email ?? "A")
    .trim()
    .charAt(0)
    .toUpperCase();

  return (
    <div
      className="min-h-screen"
      style={{ background: "#f5f4ed", color: "#141413" }}
    >
      {/* Header */}
      <header
        className="border-b"
        style={{ background: "#faf9f5", borderColor: "#f0eee6" }}
      >
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
          <Link href="/admin" className="flex items-center gap-2.5">
            <span
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-xs font-semibold text-white"
              style={{ background: "#c96442" }}
            >
              O
            </span>
            <span
              className="text-[15px] font-medium tracking-tight"
              style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
            >
              Ordy Chat <span style={{ color: "#87867f" }}>·</span>{" "}
              <span style={{ color: "#5e5d59" }}>Super Admin</span>
            </span>
          </Link>
          <div className="flex items-center gap-3 text-sm">
            <Link
              href="/admin/tenants"
              className="hidden sm:inline-flex h-8 items-center rounded-lg px-3 transition-colors"
              style={{ background: "#e8e6dc", color: "#4d4c48" }}
            >
              Vista tenant
            </Link>
            <span
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium"
              style={{ background: "#141413", color: "#faf9f5" }}
              title={session.user.email ?? ""}
            >
              {userInitial}
            </span>
            <form action="/api/auth/signout" method="post">
              <button
                type="submit"
                className="text-[13px] transition-colors hover:text-neutral-900"
                style={{ color: "#87867f" }}
              >
                Salir
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* Body */}
      <div className="mx-auto grid max-w-7xl grid-cols-[240px_1fr] gap-8 px-6 py-8">
        <aside className="space-y-6">
          {(Object.keys(groups) as Array<keyof typeof GROUP_LABEL>).map((g) => (
            <div key={g}>
              <div
                className="mb-2 px-3 text-[10px] font-medium uppercase tracking-wider"
                style={{ color: "#87867f", letterSpacing: "0.08em" }}
              >
                {GROUP_LABEL[g]}
              </div>
              <div className="space-y-0.5">
                {groups[g].map(({ href, label, icon: Icon }) => {
                  const isActive =
                    activePath === href ||
                    (activePath?.startsWith(href + "/") && href !== "/admin");
                  return (
                    <Link
                      key={href}
                      href={href}
                      className="group flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] transition-all"
                      style={{
                        background: isActive ? "#e8e6dc" : "transparent",
                        color: isActive ? "#141413" : "#4d4c48",
                        boxShadow: isActive
                          ? "inset 0 0 0 1px #d1cfc5"
                          : undefined,
                      }}
                    >
                      <span
                        className="inline-flex"
                        style={{ color: isActive ? "#c96442" : "#87867f" }}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className={isActive ? "font-medium" : ""}>{label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}

          <div
            className="mt-6 rounded-xl p-3"
            style={{ background: "#faf9f5", boxShadow: "inset 0 0 0 1px #f0eee6" }}
          >
            <div className="flex items-center gap-2 text-[11px] font-medium" style={{ color: "#5e5d59" }}>
              <span className="inline-flex" style={{ color: "#c96442" }}>
                <Boxes className="h-3.5 w-3.5" />
              </span>
              Modo super admin
            </div>
            <p className="mt-1 text-[11.5px] leading-relaxed" style={{ color: "#87867f" }}>
              Operas sobre todos los tenants. Cada mutación queda en{" "}
              <code className="font-mono text-[11px]" style={{ color: "#4d4c48" }}>
                audit_log
              </code>
              .
            </p>
          </div>
        </aside>

        <main className="min-w-0">
          {/* Brand stripe terracotta — sutil acento editorial */}
          <div
            className="mb-6 h-1 w-12 rounded-full"
            style={{ background: "#c96442" }}
            aria-hidden
          />
          {children}
        </main>
      </div>

      {/* Footer minimal */}
      <footer
        className="mt-12 border-t py-6 text-center text-[11.5px]"
        style={{
          borderColor: "#f0eee6",
          color: "#87867f",
        }}
      >
        Ordy Chat · panel interno · {new Date().getFullYear()}
      </footer>
    </div>
  );
}

/**
 * Page header reutilizable con tipografía editorial Claude.
 * Uso desde las páginas:
 *   <AdminPageHeader title="Tenants" subtitle="..." />
 */
export function AdminPageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div className="min-w-0">
        <h1
          className="text-[2rem] leading-[1.15] tracking-tight"
          style={{
            fontFamily: "Georgia, 'Times New Roman', serif",
            fontWeight: 500,
            color: "#141413",
          }}
        >
          {title}
        </h1>
        {subtitle && (
          <p
            className="mt-1 text-[14px] leading-relaxed"
            style={{ color: "#5e5d59", maxWidth: "60ch" }}
          >
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * Card "Claude" — fondo ivory, ring shadow warm en lugar de border duro.
 * Uso:
 *   <AdminCard><CardContent>...</CardContent></AdminCard>
 */
export function AdminCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl ${className ?? ""}`}
      style={{
        background: "#faf9f5",
        boxShadow: "inset 0 0 0 1px #f0eee6",
      }}
    >
      {children}
    </div>
  );
}

/**
 * Pequeño placeholder para indicar que un Receipt-like icon viene
 * (evita el unused import warning).
 */
export const _icons_ = { Receipt };
