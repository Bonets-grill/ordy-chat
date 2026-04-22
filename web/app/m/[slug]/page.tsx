// web/app/m/[slug]/page.tsx
//
// Landing PÚBLICA del menú digital por tenant: /m/<slug>
//
// Sin auth. Resuelve tenant por slug, lee menu_items + agent_config + number WA
// del tenant y renderiza una página con look de menú de restaurante (hero
// oscuro sobrio, tipografía serif para títulos, tarjeta flotante de CTAs,
// carta con separadores finos).
//
// Aditivo puro: no toca schema, APIs, brain, ni middleware. El matcher de
// proxy.ts no cubre /m/:path*, así que la ruta es pública sin tocar config.

import { and, asc, eq } from "drizzle-orm";
import { CalendarDays, MessageCircle, Phone } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { agentConfigs, menuItems, providerCredentials, tenants } from "@/lib/db/schema";
import { MenuExperience } from "./menu-experience";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageParams = { params: Promise<{ slug: string }> };

/** Detecta la descripción placeholder que genera el onboarding por defecto
 * ("Enjoy <name> where and when you want! ..."). No es texto del tenant —
 * es copy de SaaS genérico y encima en inglés. No lo mostramos. */
function isGenericOnboardingDesc(desc: string | null | undefined, tenantName: string): boolean {
  if (!desc) return true;
  const d = desc.trim().toLowerCase();
  if (!d) return true;
  const n = tenantName.toLowerCase();
  return (
    d.includes(`enjoy ${n} where and when you want`) ||
    d.includes("order online now") ||
    d === `enjoy ${n}`
  );
}

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
      id: menuItems.id,
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

  // Fallback: muchos tenants usan Evolution/Whapi con el phone cifrado dentro
  // de credentials_encrypted. En ese caso provider_credentials.phone_number es
  // NULL y los CTAs de la landing quedaban desactivados (reportado por Mario
  // 22-abr con Bonets). Fallback a agent_configs.handoff_whatsapp_phone que
  // suele ser el mismo número WA del restaurante y está en plain text.
  const phoneNumber = creds?.phoneNumber ?? cfg?.handoffWhatsappPhone ?? null;

  return { tenant: t, config: cfg ?? null, items, phoneNumber };
}

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const { slug } = await params;
  const bundle = await loadTenantBundle(slug);
  if (!bundle) return { title: "Menú no encontrado" };
  const showDesc = !isGenericOnboardingDesc(bundle.config?.businessDescription, bundle.tenant.name);
  const desc = showDesc
    ? bundle.config?.businessDescription?.trim()
    : `Carta y reservas de ${bundle.tenant.name}`;
  return {
    title: `${bundle.tenant.name} — Carta`,
    description: (desc ?? "").slice(0, 160),
    openGraph: {
      title: bundle.tenant.name,
      description: desc ?? "",
      type: "website",
    },
  };
}

export default async function PublicMenuPage({ params }: PageParams) {
  const { slug } = await params;
  const bundle = await loadTenantBundle(slug);
  if (!bundle) notFound();

  const { tenant, config, items, phoneNumber } = bundle;
  const brandColor = tenant.brandColor || "#d97706"; // ámbar-oro por defecto si tenant no tiene brand

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

  const byCategory = new Map<string, typeof items>();
  for (const it of items) {
    const key = it.category || "Otros";
    const list = byCategory.get(key) ?? [];
    list.push(it);
    byCategory.set(key, list);
  }

  const addressParts = [tenant.billingAddress, tenant.billingCity]
    .filter((x) => x && x.trim())
    .join(", ");
  const mapsHref = addressParts
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${tenant.name}, ${addressParts}`)}`
    : null;
  const schedule = config?.schedule?.trim();
  const businessDesc = config?.businessDescription?.trim();
  const showDesc = !isGenericOnboardingDesc(businessDesc, tenant.name);

  return (
    <main className="min-h-screen bg-stone-50 text-stone-900 antialiased">
      {/* Hero oscuro sobrio */}
      <header className="relative overflow-hidden bg-stone-950 text-stone-50">
        {/* Acento radial sutil del brand_color para dar calidez sin saturar */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-30"
          style={{
            background: `radial-gradient(ellipse at 25% 20%, ${brandColor}66 0%, transparent 55%), radial-gradient(ellipse at 80% 80%, ${brandColor}33 0%, transparent 50%)`,
          }}
        />
        <div className="relative mx-auto max-w-2xl px-6 pb-32 pt-14 text-center">
          {tenant.brandLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={tenant.brandLogoUrl}
              alt={tenant.name}
              className="mx-auto h-20 w-20 rounded-2xl bg-white/5 object-contain p-2 ring-1 ring-white/10"
            />
          ) : (
            <div
              className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl text-3xl font-bold ring-1 ring-white/10"
              style={{ backgroundColor: `${brandColor}33`, color: "#fff" }}
            >
              {tenant.name.charAt(0).toUpperCase()}
            </div>
          )}
          <h1 className="mt-7 font-serif text-4xl font-semibold tracking-tight sm:text-5xl">
            {tenant.name}
          </h1>
          {showDesc && businessDesc ? (
            <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-stone-300 sm:text-base">
              {businessDesc}
            </p>
          ) : null}
          <div className="mt-6 flex flex-col items-center gap-2 text-sm text-stone-300">
            {addressParts ? (
              mapsHref ? (
                <a
                  href={mapsHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 underline-offset-4 hover:text-white hover:underline"
                >
                  📍 {addressParts}
                </a>
              ) : (
                <span className="inline-flex items-center gap-2">📍 {addressParts}</span>
              )
            ) : null}
            {schedule ? (
              <span className="inline-flex max-w-md items-start gap-2 text-center text-stone-300">
                <span>🕐</span>
                <span>{schedule}</span>
              </span>
            ) : null}
          </div>
        </div>
      </header>

      {/* CTAs — card flotante bajo el hero. `-mt-20` y `z-10` aseguran que
          la card suba limpiamente sobre la transición hero → fondo crema,
          sin quedar pegada al borde del hero como "montada". */}
      <section className="relative z-10 mx-auto -mt-20 max-w-2xl px-4">
        <div className="grid grid-cols-3 gap-2 rounded-2xl bg-white p-2 shadow-2xl ring-1 ring-black/5">
          <a
            href={waHref ?? "#"}
            aria-disabled={!waHref}
            target="_blank"
            rel="noopener noreferrer"
            className={`flex flex-col items-center justify-center gap-1.5 rounded-xl py-5 text-xs font-semibold transition active:scale-95 ${!waHref ? "cursor-not-allowed bg-stone-100 text-stone-300" : "bg-emerald-500 text-white hover:bg-emerald-600"}`}
          >
            <MessageCircle className="h-6 w-6" strokeWidth={2.25} />
            <span>WhatsApp</span>
          </a>
          <a
            href={telHref ?? "#"}
            aria-disabled={!telHref}
            className={`flex flex-col items-center justify-center gap-1.5 rounded-xl py-5 text-xs font-semibold transition active:scale-95 ${!telHref ? "cursor-not-allowed bg-stone-100 text-stone-300" : "bg-stone-900 text-white hover:bg-stone-800"}`}
          >
            <Phone className="h-6 w-6" strokeWidth={2.25} />
            <span>Llamar</span>
          </a>
          <a
            href={waReserveHref ?? "#"}
            aria-disabled={!waReserveHref}
            target="_blank"
            rel="noopener noreferrer"
            className={`flex flex-col items-center justify-center gap-1.5 rounded-xl py-5 text-xs font-semibold transition active:scale-95 ${!waReserveHref ? "cursor-not-allowed bg-stone-100 text-stone-300" : "bg-amber-500 text-stone-950 hover:bg-amber-600"}`}
          >
            <CalendarDays className="h-6 w-6" strokeWidth={2.25} />
            <span>Reservar</span>
          </a>
        </div>
      </section>

      {/* Carta */}
      <section className="mx-auto mt-16 max-w-2xl px-6 pb-20">
        <div className="mb-10 text-center">
          <p className="text-[10px] font-semibold uppercase tracking-[0.4em] text-stone-500">
            Carta
          </p>
          <div className="mx-auto mt-3 h-px w-12 bg-stone-300" />
        </div>

        {items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-stone-300 p-8 text-center text-sm text-stone-500">
            Carta aún no publicada. Pregunta por WhatsApp 👆
          </div>
        ) : (
          <div className="space-y-14">
            {Array.from(byCategory.entries()).map(([category, list]) => (
              <div key={category}>
                <h2 className="mb-6 font-serif text-2xl font-semibold tracking-tight text-stone-900">
                  {category}
                </h2>
                <ul className="space-y-4">
                  {list.map((it, idx) => (
                    <li
                      key={`${category}-${idx}`}
                      data-item-id={it.id}
                      className="flex items-center gap-4 border-b border-dashed border-stone-200 pb-4 last:border-b-0 last:pb-0"
                    >
                      <div className="min-w-0 flex-1">
                        <h3 className="font-medium text-stone-900">{it.name}</h3>
                        {it.description ? (
                          <p className="mt-1 text-sm leading-snug text-stone-500">
                            {it.description}
                          </p>
                        ) : null}
                        {it.allergens && it.allergens.length > 0 ? (
                          <p className="mt-1 text-[11px] italic text-amber-700">
                            Alérgenos: {it.allergens.slice(0, 5).join(", ")}
                          </p>
                        ) : null}
                      </div>
                      <span className="shrink-0 font-serif text-base font-semibold tabular-nums text-stone-900">
                        {(it.priceCents / 100).toFixed(2).replace(".", ",")} €
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        {items.length > 0 && waHref ? (
          <p className="mt-14 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900">
            ¿Alergias o algo especial?{" "}
            <a
              href={waHref}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold underline underline-offset-2"
            >
              Pregunta por WhatsApp
            </a>
            , te atendemos al momento.
          </p>
        ) : null}
      </section>

      <footer className="border-t border-stone-200 py-6 pb-32 text-center text-[11px] text-stone-400">
        Menú digital ·{" "}
        <a href="/" className="underline-offset-2 hover:text-stone-600 hover:underline">
          Powered by Ordy Chat
        </a>
      </footer>

      {/* Client enhancement: mesero conversacional + carrito + i18n auto.
          Se monta en cliente, no bloquea el SSR, inyecta botones "+" en
          cada <li data-item-id>. */}
      <MenuExperience
        slug={slug}
        tenantName={tenant.name}
        brandColor={brandColor}
        phoneNumber={phoneNumber}
        items={items.map((it) => ({
          id: it.id,
          name: it.name,
          priceCents: it.priceCents,
          category: it.category,
        }))}
      />
    </main>
  );
}
