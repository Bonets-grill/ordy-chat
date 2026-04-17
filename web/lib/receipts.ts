// web/lib/receipts.ts — Compone y envía el email de recibo al comensal.
//
// Se llama desde el webhook Stripe cuando una order pasa a paid. Flujo:
//   1. processReceiptForOrder() → genera receipt en DB (y si Verifactu ON, firma+envía)
//   2. Si tenemos sent_email (del comensal) → enviamos email con branding del tenant
//   3. Guardamos receipt.sent_email y sent_at

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orderItems, orders, receipts, tenants } from "@/lib/db/schema";
import { renderBrandedEmail, renderBrandedEmailText } from "@/lib/email";
import { processReceiptForOrder } from "@/lib/verifactu";
import { renderQrPng } from "@/lib/verifactu/qr";

export async function generateAndSendReceipt(orderId: string, customerEmail: string | null) {
  // 1. Verifactu o skipped (dependiendo del toggle del tenant).
  const verifactuResult = await processReceiptForOrder(orderId);

  // 2. Cargamos todo para componer el email.
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) return { ok: false, reason: "order_not_found" };

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, order.tenantId)).limit(1);
  if (!tenant) return { ok: false, reason: "tenant_not_found" };

  const [receipt] = await db.select().from(receipts).where(eq(receipts.orderId, orderId)).limit(1);
  if (!receipt) return { ok: false, reason: "receipt_not_found" };

  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));

  // 3. Si no tenemos email del comensal, devolvemos sin mandar (el recibo queda
  //    accesible para descargar desde el dashboard del tenant).
  if (!customerEmail) {
    return { ok: true, emailed: false, receiptId: receipt.id, verifactu: verifactuResult.status };
  }

  // 4. Componer HTML del recibo con branding del tenant.
  const brand = {
    primary: tenant.brandColor || "#7c3aed",
    name: tenant.name,
    logoUrl: tenant.brandLogoUrl ?? undefined,
  };

  const totalEur = (order.totalCents / 100).toFixed(2);
  const subtotalEur = (order.subtotalCents / 100).toFixed(2);
  const vatEur = (order.vatCents / 100).toFixed(2);

  const itemsRows = items
    .map(
      (it) => `
        <tr>
          <td style="padding:8px 0;font-size:14px;color:#111827;">${escapeHtml(it.name)}${it.notes ? `<br><span style="font-size:12px;color:#6b7280">${escapeHtml(it.notes)}</span>` : ""}</td>
          <td style="padding:8px 0;font-size:14px;color:#6b7280;text-align:center;">×${it.quantity}</td>
          <td style="padding:8px 0;font-size:14px;color:#111827;text-align:right;">${(it.lineTotalCents / 100).toFixed(2)} €</td>
        </tr>`,
    )
    .join("");

  // QR Verifactu (si aceptado).
  let qrBlock = "";
  if (receipt.verifactuStatus === "accepted" && receipt.verifactuQrData) {
    try {
      const qrDataUrl = await renderQrPng(receipt.verifactuQrData);
      qrBlock = `
        <div style="margin-top:24px;padding:16px;border:1px solid #e5e7eb;border-radius:12px;text-align:center;background:#fafafa;">
          <img src="${qrDataUrl}" alt="QR Verifactu" style="width:140px;height:140px;">
          <p style="margin:8px 0 0 0;font-size:11px;color:#6b7280;">Factura registrada en la AEAT · Verifactu</p>
        </div>`;
    } catch {
      /* fallback sin QR */
    }
  }

  const tableHtml = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px;">
      <tr><td colspan="3" style="padding-bottom:8px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">Detalle</td></tr>
      ${itemsRows}
      <tr><td colspan="3" style="padding-top:12px;border-top:1px solid #e5e7eb"></td></tr>
      <tr>
        <td colspan="2" style="padding:4px 0;font-size:13px;color:#6b7280;">Base imponible</td>
        <td style="padding:4px 0;font-size:13px;color:#111827;text-align:right;">${subtotalEur} €</td>
      </tr>
      <tr>
        <td colspan="2" style="padding:4px 0;font-size:13px;color:#6b7280;">IVA</td>
        <td style="padding:4px 0;font-size:13px;color:#111827;text-align:right;">${vatEur} €</td>
      </tr>
      <tr>
        <td colspan="2" style="padding:8px 0 0 0;font-size:16px;font-weight:700;color:#111827;">Total</td>
        <td style="padding:8px 0 0 0;font-size:16px;font-weight:700;color:${brand.primary};text-align:right;">${totalEur} €</td>
      </tr>
    </table>
    ${qrBlock}`;

  const title = `Gracias por tu visita${order.customerName ? `, ${escapeHtml(order.customerName)}` : ""}`;
  const paragraphs = [
    `Este es tu recibo de <strong>${escapeHtml(tenant.name)}</strong>${order.tableNumber ? ` (mesa ${escapeHtml(order.tableNumber)})` : ""}.`,
    `Número de recibo: <strong>${receipt.invoiceSeries}${receipt.invoiceNumber}</strong>`,
  ];
  const legalFooter = [
    tenant.legalName,
    tenant.taxId ? `NIF ${tenant.taxId}` : null,
    tenant.billingAddress,
    [tenant.billingPostalCode, tenant.billingCity].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(" · ");

  const html = renderBrandedEmail({
    title,
    paragraphs,
    extraHtml: tableHtml,
    brand,
    recipient: customerEmail,
    footerNote: "Guarda este correo como justificante de tu consumo.",
    legalFooter: legalFooter || undefined,
  });
  const text = renderBrandedEmailText({
    title,
    paragraphs,
    brand,
    recipient: customerEmail,
    legalFooter: legalFooter || undefined,
  });

  // 5. Enviar vía Resend directo (no usamos sendBrandedEmail porque necesitamos
  //    el from del tenant si lo tuviera; por ahora usamos el global Ordy).
  const apiKey = process.env.AUTH_RESEND_KEY;
  if (!apiKey) return { ok: false, reason: "resend_not_configured" };
  const from = process.env.AUTH_EMAIL_FROM ?? "noreply@ordysuite.com";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: customerEmail,
      subject: `Recibo ${receipt.invoiceSeries}${receipt.invoiceNumber} · ${tenant.name}`,
      html,
      text,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[receipt] send failed ${res.status}: ${body}`);
    return { ok: false, reason: `resend_${res.status}`, receiptId: receipt.id };
  }

  await db
    .update(receipts)
    .set({ sentEmail: customerEmail, sentAt: new Date() })
    .where(eq(receipts.id, receipt.id));

  return { ok: true, emailed: true, receiptId: receipt.id, verifactu: verifactuResult.status };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
