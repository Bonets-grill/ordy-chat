// web/app/c/[slug]/page.tsx
//
// Comandero PÚBLICO por tenant slug — pensado para tablets en mostrador. Sin
// auth Auth.js, sin AppShell. La autenticación es por PIN del empleado.
//
// Flujo:
//   - GET /c/<slug> sin cookie empleado → muestra <PinKeypad/> full-screen.
//   - POST /api/comandero/login con { tenantSlug, pin } → setea cookie y
//     refresca → ahora getCurrentEmployee() devuelve datos y vemos el board.
//   - El board (mismo componente que /agent/comandero) lleva su propio
//     top-bar con nombre del empleado + logout.

import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tenants } from "@/lib/db/schema";
import { getCurrentEmployee } from "@/lib/employees/auth";
import { ComanderoBoard } from "../../agent/comandero/comandero-board";
import { PinKeypad } from "./pin-keypad";

export const metadata = { title: "Comandero · Ordy Chat" };
export const dynamic = "force-dynamic";

type PageParams = { params: Promise<{ slug: string }> };

export default async function PublicComanderoPage({ params }: PageParams) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) notFound();

  const [tenant] = await db
    .select({ id: tenants.id, name: tenants.name, slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .limit(1);
  if (!tenant) notFound();

  const employee = await getCurrentEmployee();

  // Cookie de empleado de OTRO tenant: caso edge donde un mesero compartió
  // tablet entre negocios. Reseteamos forzando keypad de nuevo.
  if (employee && employee.tenantId !== tenant.id) {
    redirect(`/api/comandero/logout?next=/c/${slug}`);
  }

  if (employee) {
    return (
      <ComanderoBoard
        actor={{ kind: "employee", name: employee.name, role: employee.role }}
      />
    );
  }

  return <PinKeypad tenantSlug={tenant.slug} tenantName={tenant.name} />;
}
