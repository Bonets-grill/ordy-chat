// web/app/kiosk/[token]/page.tsx
// Pantalla de cocina PÚBLICA (sin login) montada en tablets/TVs always-on.
// El token UUID de agent_configs.kiosk_token (mig 030) actúa como credencial:
// si coincide con un tenant, se renderiza su KDS board. Si no, 404.
//
// Scope: SOLO lectura de KDS + aceptar/rechazar pedidos. Nada más.
// Rotar el token en DB invalida cualquier pantalla activa.

import { notFound } from "next/navigation";
import { tenantFromKioskToken } from "@/lib/kiosk-auth";
import { KdsBoard } from "../../agent/kds/kds-board";

export const metadata = { title: "KDS Kiosco · Ordy Chat" };
export const dynamic = "force-dynamic";

export default async function KioskTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const bundle = await tenantFromKioskToken(token);
  if (!bundle) notFound();

  return (
    <main className="min-h-screen bg-neutral-50 p-4 md:p-6">
      <KdsBoard kioskToken={token} />
    </main>
  );
}
