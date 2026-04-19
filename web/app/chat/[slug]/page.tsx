// web/app/chat/[slug]/page.tsx
// Webchat público del tenant. Server component resuelve tenant + config
// (para inyectar nombre/saludo) y pasa a client UI. Sin auth.

import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { agentConfigs, tenants } from "@/lib/db/schema";
import { WebchatUI } from "./webchat-ui";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [tenant] = await db
    .select({ name: tenants.name })
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .limit(1);
  return {
    title: tenant ? `Chat con ${tenant.name}` : "Chat",
    robots: { index: false, follow: false },
  };
}

export default async function WebchatPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [tenant] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .limit(1);
  if (!tenant) notFound();

  const [config] = await db
    .select({
      agentName: agentConfigs.agentName,
      businessName: agentConfigs.businessName,
      onboardingCompleted: agentConfigs.onboardingCompleted,
      paused: agentConfigs.paused,
      fallbackMessage: agentConfigs.fallbackMessage,
    })
    .from(agentConfigs)
    .where(eq(agentConfigs.tenantId, tenant.id))
    .limit(1);

  if (!config || !config.onboardingCompleted) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black p-6 text-white">
        <div className="max-w-md rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
          <h1 className="text-xl font-semibold">Chat no disponible</h1>
          <p className="mt-2 text-sm text-white/60">
            Este negocio aún está configurando su agente.
          </p>
        </div>
      </main>
    );
  }

  return (
    <WebchatUI
      tenantSlug={slug}
      businessName={config.businessName || tenant.name}
      agentName={config.agentName || "Asistente"}
      paused={config.paused}
      fallbackMessage={config.fallbackMessage}
    />
  );
}
