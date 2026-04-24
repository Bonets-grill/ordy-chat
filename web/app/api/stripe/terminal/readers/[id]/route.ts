// web/app/api/stripe/terminal/readers/[id]/route.ts
//
// DELETE /api/stripe/terminal/readers/[id] — desempareja un reader del tenant.
//   - Borra del lado Stripe (terminal.readers.del con Stripe-Account header).
//   - Borra de DB.
//   - Multi-tenant: 404 si el reader no es del tenant autenticado.
//
// El [id] es el UUID interno (stripe_terminal_readers.id), no el reader_id
// de Stripe — para evitar enumeración cross-tenant.
//
// Mig 045.

import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { stripeTerminalReaders } from "@/lib/db/schema";
import { TenantNotConnected, stripeForTenant } from "@/lib/stripe-terminal";
import { requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_req: Request, ctx: Ctx) {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "bad_id" }, { status: 400 });
  }

  // Ownership: el reader debe pertenecer al tenant autenticado.
  const [row] = await db
    .select()
    .from(stripeTerminalReaders)
    .where(
      and(
        eq(stripeTerminalReaders.id, id),
        eq(stripeTerminalReaders.tenantId, bundle.tenant.id),
      ),
    )
    .limit(1);
  if (!row) {
    return NextResponse.json({ error: "reader_not_found" }, { status: 404 });
  }

  // Intentar borrar en Stripe. Si falla (reader ya borrado, etc.), seguimos
  // borrando local — el desincronizado se resuelve siempre a favor del estado
  // local del tenant.
  try {
    const { stripe, requestOptions } = await stripeForTenant({
      id: bundle.tenant.id,
      stripeAccountId: bundle.tenant.stripeAccountId,
    });
    await stripe.terminal.readers.del(row.readerId, requestOptions);
  } catch (e) {
    if (e instanceof TenantNotConnected) {
      // Sin Connect, igual borramos local — UI en estado limpio.
    } else {
      console.warn(
        `[terminal] stripe del reader ${row.readerId} falló (continuamos borrando local):`,
        (e as Error).message,
      );
    }
  }

  await db
    .delete(stripeTerminalReaders)
    .where(
      and(
        eq(stripeTerminalReaders.id, id),
        eq(stripeTerminalReaders.tenantId, bundle.tenant.id),
      ),
    );

  return NextResponse.json({ ok: true });
}
