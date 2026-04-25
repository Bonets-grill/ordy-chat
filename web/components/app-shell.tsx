"use client";

// web/components/app-shell.tsx — Layout tenant Apple-grade (Mig POS-redesign).
//
// Cambios v2 sobre v1:
//   - Sidebar Apple-grade: tipografía SF-system fallback (-apple-system),
//     spacing más generoso, microinteractions sutiles, badges en vivo.
//   - Search-jump (⌘K): combobox para saltar a cualquier sección sin click
//     en sidebar. Filtra por label O por keywords del item.
//   - Badges con counts live cada 30s desde /api/tenant/sidebar-counts:
//     KDS pendientes, mesas ocupadas, pedidos hoy.
//   - Scrolls 100% independientes (sidebar, main) — heredado v1.
//   - Indicator dot online/offline (verde/rojo) en sidebar header.
//   - Reagrupación lógica: 5 grupos en lugar de 3 (Hoy / Carta / Servicio /
//     Reportes / Cuenta) — mejor signal para mesero/dueño.

import {
  AlertTriangle,
  BarChart3,
  BellRing,
  Bot,
  BookOpen,
  CalendarCheck,
  CalendarX,
  ChefHat,
  ClipboardList,
  CreditCard,
  FileText,
  FlaskConical,
  LayoutDashboard,
  Menu as MenuIcon,
  MessageSquareText,
  Puzzle,
  QrCode,
  Search,
  Settings,
  Smartphone,
  Sparkles,
  Truck,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import type { Session } from "next-auth";
import { Badge } from "./ui/badge";
import { NotificationsBell } from "./notifications-bell";

type GroupKey = "today" | "menu" | "service" | "reports" | "account";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  group: GroupKey;
  /** Bind a una key del payload de /api/tenant/sidebar-counts. Si > 0 muestra badge. */
  badgeKey?: "kdsPending" | "tablesOccupied" | "todayOrders" | "comanderoOpen";
  /** Keywords adicionales para el search-jump (sinónimos). */
  keywords?: string[];
};

const NAV: NavItem[] = [
  // Hoy — vista del día (lo que pasa AHORA).
  { href: "/dashboard",          label: "Resumen",         icon: LayoutDashboard,    group: "today", badgeKey: "todayOrders", keywords: ["dashboard", "inicio", "home"] },
  { href: "/conversations",      label: "Conversaciones",  icon: MessageSquareText,  group: "today", keywords: ["chat", "whatsapp", "wa"] },
  { href: "/dashboard/playground", label: "Playground",    icon: FlaskConical,       group: "today", keywords: ["test", "probar", "sandbox"] },

  // Carta — qué vendes (configuración estática).
  { href: "/dashboard/carta",    label: "Carta",           icon: MenuIcon,           group: "menu", keywords: ["menu", "platos", "items", "productos"] },
  { href: "/dashboard/modificadores", label: "Modificadores", icon: Puzzle,         group: "menu", keywords: ["extras", "tamaño", "smash", "medallon"] },
  { href: "/dashboard/alergenos", label: "Alérgenos",      icon: AlertTriangle,     group: "menu", keywords: ["alergias", "gluten", "lactosa"] },
  { href: "/dashboard/recomendaciones", label: "Recomendaciones", icon: Sparkles,    group: "menu", keywords: ["upsell", "destacados", "estrella"] },

  // Servicio — operativa diaria (mesero / cocina / cliente).
  { href: "/agent/comandero",    label: "Comandero",       icon: ClipboardList,      group: "service", badgeKey: "comanderoOpen", keywords: ["mesero", "tomar pedido", "pos", "cobrar", "split", "dividir"] },
  { href: "/agent/kds",          label: "KDS Cocina & Bar",icon: ChefHat,            group: "service", badgeKey: "kdsPending", keywords: ["cocina", "bar", "tickets", "pendientes"] },
  { href: "/agent/tables",       label: "Mesas y QRs",     icon: QrCode,             group: "service", badgeKey: "tablesOccupied", keywords: ["mesas", "qr", "salon", "terraza", "plano"] },
  { href: "/agent/reservations", label: "Reservas",        icon: CalendarCheck,      group: "service", keywords: ["reserva", "cita", "booking"] },
  { href: "/agent/empleados",    label: "Empleados",       icon: Users,              group: "service", keywords: ["staff", "pin", "mesero", "manager"] },

  // Reportes — análisis post-evento (qué pasó).
  { href: "/dashboard/ventas",   label: "Ventas y reportes", icon: BarChart3,        group: "reports", keywords: ["ventas", "ingresos", "reporte", "pos", "ventas hoy"] },
  { href: "/agent/reportes-pos", label: "Reportes POS WA", icon: BellRing,           group: "reports", keywords: ["wa", "whatsapp", "diario"] },

  // Cuenta — config admin / fiscal / billing.
  { href: "/agent",              label: "Mi agente",       icon: Bot,                group: "account", keywords: ["bot", "ia", "system prompt"] },
  { href: "/agent/knowledge",    label: "Conocimiento",    icon: BookOpen,           group: "account", keywords: ["faq", "rag", "info"] },
  { href: "/agent/closed-days",  label: "Días cerrados",   icon: CalendarX,          group: "account", keywords: ["festivos", "vacaciones", "cierre"] },
  { href: "/agent/suppliers",    label: "Proveedores",     icon: Truck,              group: "account", keywords: ["compras", "proveedores"] },
  { href: "/dashboard/tpv",      label: "TPV (Stripe Terminal)", icon: Smartphone,   group: "account", keywords: ["tpv", "stripe", "terminal"] },
  { href: "/agent/fiscal",       label: "Datos fiscales",  icon: FileText,           group: "account", keywords: ["fiscal", "verifactu", "iva", "nif"] },
  { href: "/billing",            label: "Facturación",     icon: CreditCard,         group: "account", keywords: ["plan", "billing", "factura", "stripe"] },
];

const GROUP_LABEL: Record<GroupKey, string> = {
  today:   "Hoy",
  menu:    "Carta",
  service: "Servicio",
  reports: "Reportes",
  account: "Cuenta",
};

const GROUP_ORDER: GroupKey[] = ["today", "menu", "service", "reports", "account"];

function groupedNav() {
  const groups: Record<GroupKey, NavItem[]> = {
    today: [], menu: [], service: [], reports: [], account: [],
  };
  for (const item of NAV) groups[item.group].push(item);
  return groups;
}

type SidebarCounts = {
  kdsPending: number;
  tablesOccupied: number;
  todayOrders: number;
  comanderoOpen: number;
  tablesTotal: number;
};

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
  const pathname = usePathname();
  const [counts, setCounts] = React.useState<SidebarCounts | null>(null);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [online, setOnline] = React.useState<boolean>(true);
  const userInitial = (session.user.name ?? session.user.email ?? "T")
    .trim()
    .charAt(0)
    .toUpperCase();

  // Polling de counts cada 30s. Primer fetch inmediato. Online indicator: si
  // el fetch falla, marcamos offline y reintentamos.
  React.useEffect(() => {
    let mounted = true;
    let cancelled = false;
    async function loadCounts() {
      try {
        const r = await fetch("/api/tenant/sidebar-counts", { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = (await r.json()) as SidebarCounts;
        if (mounted) {
          setCounts(data);
          setOnline(true);
        }
      } catch {
        if (mounted) setOnline(false);
      }
    }
    void loadCounts();
    const interval = setInterval(() => {
      if (!cancelled) void loadCounts();
    }, 30_000);
    return () => {
      mounted = false;
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // ⌘K shortcut para abrir search-jump.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((s) => !s);
      }
      if (e.key === "Escape") setSearchOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      className="flex h-screen flex-col overflow-hidden bg-surface-subtle text-ink-900"
      style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif" }}
    >
      {/* Header — flex-none, no sticky. */}
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
            <span
              className={`ml-1 inline-block h-1.5 w-1.5 rounded-full transition-colors ${
                online ? "bg-emerald-500" : "bg-rose-500"
              }`}
              aria-label={online ? "Conectado" : "Sin conexión"}
              title={online ? "Conectado" : "Sin conexión"}
            />
          </Link>

          <div className="flex items-center gap-2 text-sm">
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="hidden md:inline-flex h-8 items-center gap-2 rounded-md border border-stone-200 bg-white px-2.5 text-[12.5px] text-stone-500 transition-colors hover:bg-stone-50"
              title="Buscar (⌘K)"
            >
              <Search className="h-3.5 w-3.5" />
              <span>Buscar</span>
              <kbd className="ml-1 rounded border border-stone-200 bg-stone-50 px-1.5 text-[10px] font-mono text-stone-500">⌘K</kbd>
            </button>
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

      {/* Body — flex-1 min-h-0 para que children puedan tener overflow propio. */}
      <div className="mx-auto grid w-full min-h-0 max-w-7xl flex-1 grid-cols-1 gap-8 px-6 lg:grid-cols-[252px_1fr]">
        {/* Sidebar — scroll independiente. */}
        <aside className="hidden lg:flex min-h-0 flex-col gap-5 overflow-y-auto py-7 pr-2">
          {GROUP_ORDER.map((g) => (
            <nav key={g} aria-label={GROUP_LABEL[g]}>
              <div className="mb-1.5 px-3 text-[10.5px] font-semibold uppercase tracking-wider2 text-ink-500/80">
                {GROUP_LABEL[g]}
              </div>
              <ul className="space-y-0.5">
                {groups[g].map((item) => {
                  const Icon = item.icon;
                  const active = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
                  const badgeCount = item.badgeKey && counts ? counts[item.badgeKey] : 0;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={`group relative flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-[13.5px] transition-all ${
                          active
                            ? "bg-brand-50 text-ink-900 shadow-sm ring-1 ring-brand-200/60"
                            : "text-ink-700 hover:bg-black/[0.04] hover:text-ink-900"
                        }`}
                      >
                        <Icon className={`h-4 w-4 transition-colors ${active ? "text-brand-700" : "text-ink-400 group-hover:text-ink-700"}`} />
                        <span className="flex-1 truncate">{item.label}</span>
                        {badgeCount > 0 && (
                          <span
                            className={`ml-auto inline-flex min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-semibold leading-tight ${
                              item.badgeKey === "kdsPending"
                                ? "bg-amber-100 text-amber-800"
                                : item.badgeKey === "tablesOccupied"
                                  ? "bg-emerald-100 text-emerald-800"
                                  : "bg-stone-200 text-stone-700"
                            }`}
                          >
                            {badgeCount > 99 ? "99+" : badgeCount}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
          ))}

          {/* Plan card al final */}
          <div
            className="mt-auto rounded-xl bg-surface-card p-4 shadow-ringSubtle"
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

        <main className="min-h-0 min-w-0 overflow-y-auto py-7">{children}</main>
      </div>

      {/* Search-jump command-K modal */}
      {searchOpen && (
        <SearchJumpModal items={NAV} onClose={() => setSearchOpen(false)} />
      )}
    </div>
  );
}

function SearchJumpModal({
  items,
  onClose,
}: {
  items: NavItem[];
  onClose: () => void;
}) {
  const [query, setQuery] = React.useState("");
  const [activeIdx, setActiveIdx] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = React.useMemo(() => {
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    return items.filter((it) => {
      if (it.label.toLowerCase().includes(q)) return true;
      if (it.keywords?.some((k) => k.toLowerCase().includes(q))) return true;
      return false;
    });
  }, [items, query]);

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const it = filtered[activeIdx];
      if (it) {
        window.location.href = it.href;
        onClose();
      }
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-stone-900/40 p-4 pt-[15vh]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-stone-200"
        onClick={(e) => e.stopPropagation()}
        style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif" }}
      >
        <div className="flex items-center gap-2 border-b border-stone-100 px-4 py-3">
          <Search className="h-4 w-4 text-stone-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIdx(0);
            }}
            onKeyDown={onKey}
            placeholder="Saltar a sección — Carta, Comandero, Ventas, KDS…"
            className="flex-1 bg-transparent text-sm text-stone-900 outline-none placeholder:text-stone-400"
          />
          <kbd className="rounded border border-stone-200 bg-stone-50 px-1.5 text-[10px] font-mono text-stone-500">esc</kbd>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <li className="px-4 py-3 text-sm text-stone-500">Sin resultados.</li>
          ) : (
            filtered.map((it, i) => {
              const Icon = it.icon;
              return (
                <li key={it.href}>
                  <Link
                    href={it.href}
                    onClick={onClose}
                    className={`flex items-center gap-3 px-4 py-2 text-sm transition-colors ${
                      i === activeIdx ? "bg-brand-50 text-ink-900" : "text-stone-700 hover:bg-stone-50"
                    }`}
                    onMouseEnter={() => setActiveIdx(i)}
                  >
                    <Icon className="h-4 w-4 text-stone-400" />
                    <span className="flex-1">{it.label}</span>
                    <span className="text-[10px] uppercase tracking-wider text-stone-400">
                      {GROUP_LABEL[it.group]}
                    </span>
                  </Link>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}

/**
 * PageHeader — H1 + subtítulo + actions estandarizado.
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
