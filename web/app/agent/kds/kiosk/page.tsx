// web/app/agent/kds/kiosk/page.tsx
// Modo "pantalla cocina": renderiza solo el KDS board, sin AppShell (sin sidebar,
// sin "Salir", sin banner de trial). Pensado para montar en tablets/TVs de
// cocina como dashboard always-on.
//
// Auth: misma session que el dashboard normal. La cookie de Auth.js dura ~30 días
// y se refresca con cada fetch del polling del board, así que la pantalla se
// mantiene viva mientras haya actividad. Si expira, redirige a /signin.

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { requireTenant } from "@/lib/tenant";
import { KdsBoard } from "../kds-board";

export const metadata = { title: "KDS Kiosco · Ordy Chat" };

export default async function KdsKioskPage() {
  const session = await auth();
  if (!session) redirect("/signin?from=/agent/kds/kiosk");

  const bundle = await requireTenant();
  if (!bundle) redirect("/onboarding");

  return (
    <main className="min-h-screen bg-neutral-50 p-4 md:p-6">
      <KdsBoard />
    </main>
  );
}
