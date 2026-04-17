// web/lib/verifactu/index.ts — Orquestador de registro Verifactu.
//
// Entrada: order + tenant + tenant_fiscal_config + receipt previo (para encadenar).
// Salida: receipt enriquecido con huella, QR, respuesta AEAT.
//
// Solo se llama si tenant_fiscal_config.verifactu_enabled === true. Si falla,
// el recibo queda en verifactu_status='error' y el error se guarda en
// verifactu_response para que el tenant lo revise.

import { and, desc, eq } from "drizzle-orm";
import { descifrar } from "@/lib/crypto";
import { db } from "@/lib/db";
import { orderItems, orders, receipts, tenantFiscalConfig, tenants } from "@/lib/db/schema";
import { computeHuella } from "@/lib/verifactu/hash";
import { buildVerifactuUrl } from "@/lib/verifactu/qr";
import { extractSigningMaterial } from "@/lib/verifactu/sign";
import { submitRegistroFactura } from "@/lib/verifactu/submit";
import { buildRegistroFacturaXml } from "@/lib/verifactu/xml";

export type ProcessResult = {
  status: "skipped" | "submitted" | "accepted" | "rejected" | "error";
  receiptId?: string;
  verifactuQrData?: string;
  verifactuHash?: string;
  error?: string;
};

/**
 * Procesa un recibo Verifactu para una orden pagada. Idempotente:
 * si ya existe un receipt para la order, lo devuelve tal cual.
 */
export async function processReceiptForOrder(orderId: string): Promise<ProcessResult> {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) return { status: "error", error: "order_not_found" };
  if (order.status !== "paid") return { status: "error", error: "order_not_paid" };

  // Ya procesado.
  const [existing] = await db.select().from(receipts).where(eq(receipts.orderId, orderId)).limit(1);
  if (existing) {
    return {
      status: existing.verifactuStatus as ProcessResult["status"],
      receiptId: existing.id,
      verifactuQrData: existing.verifactuQrData ?? undefined,
      verifactuHash: existing.verifactuHash ?? undefined,
    };
  }

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, order.tenantId)).limit(1);
  if (!tenant) return { status: "error", error: "tenant_not_found" };

  const [config] = await db
    .select()
    .from(tenantFiscalConfig)
    .where(eq(tenantFiscalConfig.tenantId, order.tenantId))
    .limit(1);

  const verifactuOn = Boolean(config?.verifactuEnabled && config?.certificateEncrypted);

  // Siguiente número de factura (idempotente vía UNIQUE(tenant_id, series, number)).
  const invoiceSeries = config?.invoiceSeries ?? "A";
  const nextNumber = (config?.invoiceCounter ?? 0) + 1;

  if (!verifactuOn) {
    // Verifactu desactivado: solo guardamos el recibo sin firma ni envío.
    const [created] = await db
      .insert(receipts)
      .values({
        orderId: order.id,
        tenantId: order.tenantId,
        invoiceSeries,
        invoiceNumber: nextNumber,
        verifactuStatus: "skipped",
      })
      .returning();
    if (config) {
      await db
        .update(tenantFiscalConfig)
        .set({ invoiceCounter: nextNumber, updatedAt: new Date() })
        .where(eq(tenantFiscalConfig.tenantId, order.tenantId));
    }
    return { status: "skipped", receiptId: created.id };
  }

  // Verifactu ON: construir cadena + XML + submit.
  if (!tenant.taxId || !tenant.legalName) {
    return { status: "error", error: "missing_fiscal_data" };
  }

  // Huella previa: último receipt del tenant con huella válida.
  const [previous] = await db
    .select({ hash: receipts.verifactuHash })
    .from(receipts)
    .where(and(eq(receipts.tenantId, tenant.id), eq(receipts.verifactuStatus, "accepted")))
    .orderBy(desc(receipts.createdAt))
    .limit(1);
  const huellaAnterior = previous?.hash ?? "";

  // Líneas del pedido para desglose.
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));

  const fechaExpedicion = new Date();
  const fechaExpedicionStr = formatDateDDMMYYYY(fechaExpedicion);
  const fechaHoraGen = isoWithTz(new Date());

  const cuotaTotalEur = order.vatCents / 100;
  const totalEur = order.totalCents / 100;

  const huellaActual = computeHuella({
    emisorNif: tenant.taxId,
    serieNumero: `${invoiceSeries}${nextNumber}`,
    fechaExpedicion: fechaExpedicionStr,
    tipoFactura: "F2",
    cuotaTotal: cuotaTotalEur.toFixed(2),
    importeTotal: totalEur.toFixed(2),
    huellaAnterior,
    fechaHoraGenRegistro: fechaHoraGen,
  });

  const xml = buildRegistroFacturaXml({
    emisor: { nif: tenant.taxId, razonSocial: tenant.legalName },
    invoiceSeries,
    invoiceNumber: nextNumber,
    fechaExpedicion,
    tipoFactura: "F2",
    descripcion: `Consumición mesa ${order.tableNumber ?? ""}`.trim(),
    lineas: items.map((it) => ({
      baseImponible: it.lineTotalCents / 100,
      tipoImpositivo: parseFloat(it.vatRate),
      cuotaIva: Math.round(it.lineTotalCents * (parseFloat(it.vatRate) / 100)) / 100,
    })),
    importeTotal: totalEur,
    cuotaTotalIva: cuotaTotalEur,
    huellaActual,
    huellaAnterior,
    fechaHoraGenRegistro: fechaHoraGen,
  });

  // Insertar receipt en estado "pending" para reservar número (UNIQUE).
  const [receipt] = await db
    .insert(receipts)
    .values({
      orderId: order.id,
      tenantId: order.tenantId,
      invoiceSeries,
      invoiceNumber: nextNumber,
      verifactuStatus: "pending",
      verifactuHash: huellaActual,
    })
    .returning();

  await db
    .update(tenantFiscalConfig)
    .set({ invoiceCounter: nextNumber, updatedAt: new Date() })
    .where(eq(tenantFiscalConfig.tenantId, order.tenantId));

  // Descifrar certificado del tenant SOLO aquí en memoria.
  try {
    const certB64 = descifrar(config!.certificateEncrypted!);
    const password = descifrar(config!.certificatePasswordEncrypted!);
    const p12Bytes = Buffer.from(certB64, "base64");
    const { certPem, privateKeyPem } = extractSigningMaterial(p12Bytes, password);

    const result = await submitRegistroFactura({
      environment: (config!.verifactuEnvironment as "sandbox" | "production") ?? "sandbox",
      certPem,
      privateKeyPem,
      xmlPayload: xml,
    });

    const qrUrl = buildVerifactuUrl({
      nif: tenant.taxId,
      invoiceSeries,
      invoiceNumber: nextNumber,
      invoiceDate: fechaExpedicion,
      totalAmount: totalEur,
      environment: (config!.verifactuEnvironment as "sandbox" | "production") ?? "sandbox",
    });

    await db
      .update(receipts)
      .set({
        verifactuStatus: result.acknowledged ? "accepted" : "rejected",
        verifactuSubmittedAt: new Date(),
        verifactuResponse: {
          statusCode: result.statusCode,
          acknowledged: result.acknowledged,
          rejectionReason: result.rejectionReason,
          body: result.responseBody.slice(0, 5000),
        },
        verifactuQrData: qrUrl,
      })
      .where(eq(receipts.id, receipt.id));

    return {
      status: result.acknowledged ? "accepted" : "rejected",
      receiptId: receipt.id,
      verifactuQrData: qrUrl,
      verifactuHash: huellaActual,
      error: result.rejectionReason,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db
      .update(receipts)
      .set({
        verifactuStatus: "error",
        verifactuSubmittedAt: new Date(),
        verifactuResponse: { error: msg },
      })
      .where(eq(receipts.id, receipt.id));
    return { status: "error", receiptId: receipt.id, verifactuHash: huellaActual, error: msg };
  }
}

function formatDateDDMMYYYY(d: Date): string {
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${day}-${month}-${d.getFullYear()}`;
}

function isoWithTz(d: Date): string {
  // Node Date.toISOString da UTC; AEAT pide ISO con offset. Usamos formato
  // compatible: "2026-04-17T12:34:56+02:00" calculando offset local.
  const pad = (n: number) => String(n).padStart(2, "0");
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const off = `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${off}`
  );
}
