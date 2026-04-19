// web/app/api/receipts/[id]/pdf/route.ts
// GET — sirve el PDF de un recibo on-demand. Auth: requireTenant + ownership.
// No persistimos el PDF; regeneramos idempotentemente desde DB cada vez.

import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { orderItems, orders, receipts, tenants } from "@/lib/db/schema";
import { buildInvoicePdf } from "@/lib/fiscal/pdf";
import { requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const { id } = await ctx.params;

  const [receipt] = await db
    .select()
    .from(receipts)
    .where(and(eq(receipts.id, id), eq(receipts.tenantId, bundle.tenant.id)))
    .limit(1);
  if (!receipt) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, receipt.orderId))
    .limit(1);
  if (!order) return NextResponse.json({ error: "order_missing" }, { status: 404 });

  const items = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, order.id));

  const [tenant] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.id, bundle.tenant.id))
    .limit(1);
  if (!tenant) return NextResponse.json({ error: "tenant_missing" }, { status: 404 });

  const pdfBytes = await buildInvoicePdf({
    tenant: {
      legalName: tenant.legalName,
      name: tenant.name,
      taxId: tenant.taxId,
      billingAddress: tenant.billingAddress,
      billingPostalCode: tenant.billingPostalCode,
      billingCity: tenant.billingCity,
      billingCountry: tenant.billingCountry,
      taxLabel: tenant.taxLabel,
      brandColor: tenant.brandColor,
    },
    order: {
      id: order.id,
      tableNumber: order.tableNumber,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      subtotalCents: order.subtotalCents,
      taxCents: order.taxCents,
      totalCents: order.totalCents,
      currency: order.currency,
      notes: order.notes,
    },
    items: items.map((it) => ({
      name: it.name,
      quantity: it.quantity,
      unitPriceCents: it.unitPriceCents,
      taxRate: String(it.taxRate),
      taxLabel: it.taxLabel,
      lineTotalCents: it.lineTotalCents,
      notes: it.notes,
    })),
    receipt: {
      invoiceSeries: receipt.invoiceSeries,
      invoiceNumber: Number(receipt.invoiceNumber),
      createdAt: receipt.createdAt,
      verifactuQrData: receipt.verifactuQrData,
      verifactuHash: receipt.verifactuHash,
      verifactuStatus: receipt.verifactuStatus,
    },
  });

  const filename = `${receipt.invoiceSeries}-${String(receipt.invoiceNumber).padStart(6, "0")}.pdf`;

  return new NextResponse(pdfBytes as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
