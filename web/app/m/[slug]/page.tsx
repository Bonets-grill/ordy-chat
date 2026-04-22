// web/app/m/[slug]/page.tsx
//
// Landing PÚBLICA del menú digital por tenant: /m/<slug>
//
// Sin auth. Resuelve tenant por slug, lee menu_items + agent_config + number WA
// del tenant y renderiza una página simple con:
//   - Hero (nombre, logo, horario, zona).
//   - Carta agrupada por categoría con precios.
//   - 3 CTAs: WhatsApp (deep link prefilled), Llamar (si hay número), Reservar
//     (abre WA con texto prefilled — cero backend adicional).
//
// Aditivo puro: no toca schema, APIs, brain, ni middleware. El matcher de
// proxy.ts no cubre /m/:path*, así que la ruta es pública sin tocar config.

import { and, asc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { agentConfigs, menuItems, providerCredentials, tenants } from "@/lib/db/schema";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageParams = { params: Promise<{ slug: string }> };

async function loadTenantBundle(slug: string) {
  const [t] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .limit(1);
  if (!t) return null;

  const [cfg] = await db
    .select()
    .from(agentConfigs)
    .where(eq(agentConfigs.tenantId, t.id))
    .limit(1);

  const items = await db
    .select({
      category: menuItems.category,
      name: menuItems.name,
      priceCents: menuItems.priceCents,
      description: menuItems.description,
      allergens: menuItems.allergens,
      sortOrder: menuItems.sortOrder,
    })
    .from(menuItems)
    .where(and(eq(menuItems.tenantId, t.id), eq(menuItems.available, true)))
    .orderBy(asc(menuItems.category), asc(menuItems.sortOrder), asc(menuItems.name));

  const [creds] = await db
    .select({ phoneNumber: providerCredentials.phoneNumber })
    .from(providerCredentials)
    .where(eq(providerCredentials.tenantId, t.id))
    .limit(1);

  return { tenant: t, config: cfg ?? null, items, phoneNumber: creds?.phoneNumber ?? null };
}

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const { slug } = await params;
  const bundle = await loadTenantBundle(slug);
  if (!bundle) return { title: "Menú no encontrado" };
  const desc = bundle.config?.businessDescription?.trim() || `Carta y reservas de ${bundle.tenant.name}`;
  return {
    title: `${bundle.tenant.name} — Carta digital`,
    description: desc.slice(0, 160),
  };
}

export default async function PublicMenuPage({ params }: PageParams) {
  const { slug } = await params;
  const bundle = await loadTenantBundle(slug);
  if (!bundle) notFound();

  const { tenant, config, items, phoneNumber } = bundle;
  const brandColor = tenant.brandColor || "#7c3aed";
  // Teléfono en formato internacional sin + para wa.me (requiere solo dígitos).
  const waDigits = (phoneNumber ?? "").replace(/\D/g, "");
  const waHref = waDigits
    ? `https://wa.me/${waDigits}?text=${encodeURIComponent("Hola, vengo desde la web")}`
    : null;
  const waReserveHref = waDigits
    ? `https://wa.me/${waDigits}?text=${encodeURIComponent(
        "Hola, me gustaría reservar mesa. ¿Me podéis decir disponibilidad?",
      )}`
    : null;
  const telHref = phoneNumber ? `tel:${phoneNumber}` : null;

  // Agrupa items por categoría manteniendo orden de aparición.
  const byCategory = new Map<string, typeof items>();
  for (const it of items) {
    const key = it.category || "Otros";
    const list = byCategory.get(key) ?? [];
    list.push(it);
    byCategory.set(key, list);
  }

  const addressParts = [tenant.billingAddress, tenant.billingCity, tenant.billingCountry]
    .filter(Boolean)
    .join(", ");
  const schedule = config?.schedule?.trim();
  const businessDesc = config?.businessDescription?.trim();

  return (
    <main className="min-h-screen bg-neutral-50 text-neutral-900">
      {/* Hero */}
      <header
        className="relative px-5 pb-8 pt-10 text-white"
        style={{ background: `linear-gradient(135deg, ${brandColor} 0%, ${brandColor}cc 100%)` }}
      >
        <div className="mx-auto max-w-2xl">
          {tenant.brandLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={tenant.brandLogoUrl}
              alt={tenant.name}
              className="mb-4 h-16 w-16 rounded-2xl bg-white/10 object-contain p-2 ring-2 ring-white/20"
            />
          ) : (
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/15 text-2xl font-bold ring-2 ring-white/20">
              {tenant.name.charAt(0).toUpperCase()}
            </div>
          )}
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{tenant.name}</h1>
          {businessDesc ? (
            <p className="mt-2 max-w-xl text-sm text-white/90 sm:text-base">{businessDesc}</p>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-3 text-xs text-white/90 sm:text-sm">
            {addressParts ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-3 py-1 ring-1 ring-white/20">
                📍 {addressParts}
              </span>
            ) : null}
            {schedule ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-3 py-1 ring-1 ring-white/20">
                🕐 {schedule}
              </span>
            ) : null}
          </div>
        </div>
      </header>

      {/* CTAs */}
      <section className="mx-auto -mt-6 max-w-2xl px-5">
        <div className="grid grid-cols-1 gap-2 rounded-2xl bg-white p-2 shadow-lg ring-1 ring-neutral-200 sm:grid-cols-3">
          <a
            href={waHref ?? "#"}
            aria-disabled={!waHref}
            className={`inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 ${!waHref ? "pointer-events-none opacity-40" : ""}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            💬 WhatsApp
          </a>
          <a
            href={telHref ?? "#"}
            aria-disabled={!telHref}
            className={`inline-flex items-center justify-center gap-2 rounded-xl bg-neutral-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-neutral-800 ${!telHref ? "pointer-events-none opacity-40" : ""}`}
          >
            📞 Llamar
          </a>
          <a
            href={waReserveHref ?? "#"}
            aria-disabled={!waReserveHref}
            className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition ${!waReserveHref ? "pointer-events-none opacity-40" : "bg-neutral-100 text-neutral-900 hover:bg-neutral-200"}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            📅 Reservar
          </a>
        </div>
      </section>

      {/* Menú */}
      <section className="mx-auto mt-10 max-w-2xl px-5 pb-16">
        <h2 className="mb-6 text-xl font-semibold tracking-tight">Carta</h2>
        {items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500">
            Carta aún no publicada. Pregunta por WhatsApp 👆
          </div>
        ) : (
          <div className="space-y-8">
            {Array.from(byCategory.entries()).map(([category, list]) => (
              <div key={category}>
                <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500">
                  {category}
                </h3>
                <ul className="divide-y divide-neutral-200 rounded-xl bg-white ring-1 ring-neutral-200">
                  {list.map((it, idx) => (
                    <li key={`${category}-${idx}`} className="flex items-baseline gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <span className="truncate font-medium text-neutral-900">{it.name}</span>
                          {it.allergens && it.allergens.length > 0 ? (
                            <span className="shrink-0 text-[10px] uppercase tracking-wider text-amber-700">
                              · {it.allergens.slice(0, 3).join(", ")}
                            </span>
                          ) : null}
                        </div>
                        {it.description ? (
                          <p className="mt-0.5 text-xs text-neutral-500">{it.description}</p>
                        ) : null}
                      </div>
                      <span className="shrink-0 font-mono text-sm font-semibold tabular-nums text-neutral-900">
                        {(it.priceCents / 100).toFixed(2).replace(".", ",")} €
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        {/* Alergia hint */}
        {items.length > 0 && waHref ? (
          <p className="mt-8 rounded-xl bg-amber-50 px-4 py-3 text-xs text-amber-900 ring-1 ring-amber-200">
            ¿Tienes alergias o necesitas algo especial?{" "}
            <a href={waHref} target="_blank" rel="noopener noreferrer" className="font-semibold underline">
              Pregunta por WhatsApp
            </a>
            .
          </p>
        ) : null}
      </section>

      <footer className="border-t border-neutral-200 py-6 text-center text-xs text-neutral-500">
        Menú digital · <a href="/" className="underline hover:text-neutral-700">Powered by Ordy Chat</a>
      </footer>
    </main>
  );
}
