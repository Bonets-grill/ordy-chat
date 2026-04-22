// web/app/dashboard/playground/page.tsx
// Playground del tenant: prueba del agente con chips + input libre + 👍/👎.
// Mig 029: ahora SÍ persiste pedidos/reservas/conversaciones marcados is_test=true
// para que aparezcan en KDS/Reservas/Conversaciones cuando el admin active
// "🧪 Incluir pruebas". NO envía WhatsApp real a clientes (customer_phone ficticio).

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
          <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
            <strong>🧪 Modo prueba (end-to-end real):</strong> pedidos, reservas y
            conversaciones se GUARDAN marcados como pruebas y aparecen en KDS,
            Reservas y Conversaciones con el toggle <em>"Incluir pruebas"</em>. No
            se envía nada por WhatsApp a clientes reales. Si pides un handoff, sí
            llegará un WhatsApp al admin con prefijo <em>🧪 PRUEBA PLAYGROUND</em>.
          </div>
        </header>
        <PlaygroundChat tenantName={bundle.tenant.name} chips={chips} />
      </div>
    </AppShell>
  );
}
