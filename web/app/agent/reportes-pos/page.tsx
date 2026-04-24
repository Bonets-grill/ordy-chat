// web/app/agent/reportes-pos/page.tsx
// Mig 040. Panel donde el tenant configura qué teléfonos WA reciben los
// reportes POS automáticos (turno auto-abierto, cierre manual, resumen
// diario 23:55).

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { agentConfigs } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";
import { PosReportsEditor } from "./editor";

export const dynamic = "force-dynamic";

export default async function ReportesPosPage() {
  const session = await auth();
  if (!session) redirect("/signin?from=/agent/reportes-pos");
  const bundle = await requireTenant();
  if (!bundle) redirect("/onboarding");

  const [cfg] = await db
    .select({
      posReportPhones: agentConfigs.posReportPhones,
      handoffWhatsappPhone: agentConfigs.handoffWhatsappPhone,
    })
    .from(agentConfigs)
    .where(eq(agentConfigs.tenantId, bundle.tenant.id))
    .limit(1);

  const phones = cfg?.posReportPhones ?? [];
  const fallback = cfg?.handoffWhatsappPhone ?? null;

  return (
    <AppShell
      session={session}
      subscriptionStatus={bundle.tenant.subscriptionStatus}
      trialDaysLeft={bundle.trialDaysLeft}
    >
      <div className="mb-6">
        <h1 className="text-3xl font-semibold text-neutral-900">Reportes POS por WhatsApp</h1>
        <p className="mt-1 text-neutral-500">
          Qué números reciben los avisos automáticos de caja: turno
          auto-abierto, cierre de turno con el cuadre, y el resumen diario
          a las 23:55.
        </p>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Cómo funciona</CardTitle>
          <CardDescription>
            Recibirás 3 tipos de mensaje por WhatsApp:
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-neutral-700">
          <div>
            <p className="font-medium text-neutral-900">🔔 Turno auto-abierto</p>
            <p className="text-neutral-600">
              Cuando entra un pedido y nadie había abierto el turno. Se abre
              uno automático con caja inicial 0 € y recibes el aviso.
            </p>
          </div>
          <div>
            <p className="font-medium text-neutral-900">✅ Turno cerrado</p>
            <p className="text-neutral-600">
              Cuando cierras un turno desde el panel. Incluye cuadre completo
              (opening, esperado, contado, diferencia) y top 3 de productos.
            </p>
          </div>
          <div>
            <p className="font-medium text-neutral-900">🌙 Resumen del día</p>
            <p className="text-neutral-600">
              Cron automático a las 23:55 (Madrid). Cierra los turnos
              abiertos que queden y manda el resumen completo del día.
            </p>
          </div>
        </CardContent>
      </Card>

      <PosReportsEditor initialPhones={phones} fallback={fallback} />
    </AppShell>
  );
}
