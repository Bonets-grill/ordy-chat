// web/app/dashboard/ventas/_tabs.tsx
// Mig 041: barra de tabs común a todas las pantallas /dashboard/ventas/*.
// Server-side, sin client routing — cada tab navega via Link normal.
//
// El period actual se propaga por query param para que al cambiar de tab
// no se pierda el filtro (ej. estás en "Hoy" en horas pico, pulsas
// "Productos" → sigue en "Hoy").
import Link from "next/link";

export type VentasPeriod = "today" | "7d" | "30d";

const TABS = [
  { href: "/dashboard/ventas", label: "Resumen" },
  { href: "/dashboard/ventas/horas", label: "Horas pico" },
  { href: "/dashboard/ventas/productos", label: "Top productos" },
  { href: "/dashboard/ventas/pareto", label: "80/20" },
  { href: "/dashboard/ventas/propinas", label: "Propinas" },
] as const;

const PERIOD_LABELS: Record<VentasPeriod, string> = {
  today: "Hoy",
  "7d": "7 días",
  "30d": "30 días",
};

export function VentasTabs({
  active,
  period,
  hidePeriodSwitcher = false,
}: {
  active: (typeof TABS)[number]["href"];
  period?: VentasPeriod;
  hidePeriodSwitcher?: boolean;
}) {
  return (
    <div className="border-b border-neutral-200">
      <div className="flex flex-wrap items-baseline gap-x-1 gap-y-2">
        {TABS.map((t) => {
          const href =
            t.href === "/dashboard/ventas"
              ? "/dashboard/ventas"
              : period
                ? `${t.href}?period=${period}`
                : t.href;
          const isActive = t.href === active;
          return (
            <Link
              key={t.href}
              href={href}
              className={`-mb-px px-3 py-2 text-sm font-medium transition border-b-2 ${
                isActive
                  ? "border-brand-600 text-brand-700"
                  : "border-transparent text-neutral-600 hover:text-neutral-900"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
      {!hidePeriodSwitcher && period && active !== "/dashboard/ventas" && (
        <div className="mt-2 flex flex-wrap items-baseline gap-1 pb-2">
          <span className="text-[10px] font-medium uppercase tracking-wider text-neutral-500 mr-1">
            Período
          </span>
          {(["today", "7d", "30d"] as const).map((p) => (
            <Link
              key={p}
              href={`${active}?period=${p}`}
              className={`rounded-full border px-3 py-0.5 text-xs transition ${
                period === p
                  ? "border-brand-600 bg-brand-50 text-brand-700"
                  : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300"
              }`}
            >
              {PERIOD_LABELS[p]}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Lee `period` del query param. Default "30d" (mismo que /api/reports/*).
 * Filtra valores fuera del enum.
 */
export function readPeriodParam(input: string | string[] | undefined): VentasPeriod {
  const v = Array.isArray(input) ? input[0] : input;
  if (v === "today" || v === "7d" || v === "30d") return v;
  return "30d";
}
