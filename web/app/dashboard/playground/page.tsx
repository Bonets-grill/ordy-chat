// web/app/dashboard/playground/page.tsx
// Playground del tenant: prueba del agente con chips + input libre + 👍/👎.
// NO toca conversations/messages, NO envía WhatsApp real. Simula brain.

import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { auth } from "@/lib/auth";
import { requireTenant } from "@/lib/tenant";
import { PlaygroundChat } from "./playground-chat";
import { chipsForTenant } from "./chips";

export const dynamic = "force-dynamic";

export default async function PlaygroundPage() {
  const session = await auth();
  if (!session) redirect("/signin?from=/dashboard/playground");
  const bundle = await requireTenant();
  if (!bundle) redirect("/onboarding");

  // Chips según nicho del tenant (heurística por business_description del
  // agent_config). Si no sale nicho claro, usamos set universal.
  const chips = chipsForTenant({
    businessName: bundle.tenant.name,
    description: bundle.config?.businessDescription ?? "",
  });

  return (
    <AppShell
      session={session}
      subscriptionStatus={bundle.tenant.subscriptionStatus}
      trialDaysLeft={bundle.trialDaysLeft}
    >
      <div className="mx-auto max-w-3xl">
        <header className="mb-4">
          <h1 className="text-3xl font-semibold text-neutral-900">Playground</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Prueba a tu agente con preguntas de ejemplo o las tuyas. Esto NO envía
            mensajes a tus clientes — es una prueba contigo mismo. Si una respuesta
            es mala, pulsa 👎 y la enviaremos al equipo Ordy para ayudarte.
          </p>
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <strong>Modo sandbox:</strong> aunque el bot diga "reserva confirmada" o
            "pedido registrado", esas acciones NO se guardan. No verás aquí nada en
            Reservas, Conversaciones ni KDS. Para probar end-to-end de verdad, escribe
            al WhatsApp del negocio.
          </div>
        </header>
        <PlaygroundChat tenantName={bundle.tenant.name} chips={chips} />
      </div>
    </AppShell>
  );
}
