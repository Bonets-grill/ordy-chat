// web/app/api/reseller/payouts/[id]/invoice/route.ts
// POST: el reseller sube el PDF de su factura de comisión.
// Mig 047: cierra el TODO F5 post-MVP (eu-vat / fallback strategies que requieren
// self-billing o factura emitida por el reseller).
//
// Solo el dueño del payout puede subir. Solo en estados pre-pagado:
// queued|tax_calculated|ready. No se puede sobreescribir un PDF ya subido si el
// payout ya está paid (audit trail).

import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { put } from "@vercel/blob";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { auditLog, resellerPayouts } from "@/lib/db/schema";
import { getSessionReseller } from "@/lib/reseller/scope";
import { limitByUserId } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ACCEPTED = new Set(["application/pdf"]);
const UPLOADABLE_STATUSES = new Set(["queued", "tax_calculated", "ready"]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "reseller") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await params;

  const rate = await limitByUserId(session.user.id, "payout_invoice_upload", 20, "1 h");
  if (!rate.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const reseller = await getSessionReseller(session);

  const [payout] = await db
    .select()
    .from(resellerPayouts)
    .where(eq(resellerPayouts.id, id))
    .limit(1);
  if (!payout) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (payout.resellerId !== reseller.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!UPLOADABLE_STATUSES.has(payout.status)) {
    return NextResponse.json(
      { error: "invalid_state", current: payout.status },
      { status: 409 },
    );
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file_required" }, { status: 400 });
  }
  if (!ACCEPTED.has(file.type)) {
    return NextResponse.json({ error: "only_pdf_allowed" }, { status: 415 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "file_too_large", max_bytes: MAX_BYTES }, { status: 413 });
  }

  const filename = `reseller-invoices/${reseller.id}/${payout.id}.pdf`;
  const blob = await put(filename, file, {
    access: "public",
    contentType: "application/pdf",
    addRandomSuffix: false,
    allowOverwrite: true,
  });

  await db
    .update(resellerPayouts)
    .set({ invoicePdfUrl: blob.url })
    .where(eq(resellerPayouts.id, payout.id));

  await db.insert(auditLog).values({
    action: "reseller.payout.invoice_uploaded",
    entity: "reseller_payout",
    entityId: payout.id,
    userId: session.user.id,
    metadata: { url: blob.url, size_bytes: file.size },
  });

  return NextResponse.json({ ok: true, url: blob.url });
}
