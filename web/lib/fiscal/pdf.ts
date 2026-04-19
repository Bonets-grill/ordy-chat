// web/lib/fiscal/pdf.ts — Generador de factura/recibo PDF con QR Verifactu.
//
// Diseño: A4, minimalista, legalmente válido:
//   - Cabecera con logo/nombre + datos fiscales del emisor
//   - Número factura + fecha
//   - Datos receptor (o "Consumidor final" si no hay NIF)
//   - Tabla de conceptos (qty, desc, precio unit, base, IVA, total línea)
//   - Totales (base imponible + IVA + total)
//   - QR Verifactu en esquina inferior derecha + huella al pie
//
// On-demand: se genera en memoria y se sirve directamente. NO persistimos el PDF.
// Si AEAT obliga a guardar 4 años, regeneramos idempotentemente desde los datos
// (receipt + order + items + tenant están en DB permanente).

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import QRCode from "qrcode";

export type PdfInput = {
  tenant: {
    legalName: string | null;
    name: string;
    taxId: string | null;
    billingAddress: string | null;
    billingPostalCode: string | null;
    billingCity: string | null;
    billingCountry: string;
    taxLabel: string;
    brandColor: string;
  };
  order: {
    id: string;
    tableNumber: string | null;
    customerName: string | null;
    customerPhone: string | null;
    subtotalCents: number;
    taxCents: number;
    totalCents: number;
    currency: string;
    notes: string | null;
  };
  items: Array<{
    name: string;
    quantity: number;
    unitPriceCents: number;
    taxRate: string; // "10.00"
    taxLabel: string;
    lineTotalCents: number;
    notes: string | null;
  }>;
  receipt: {
    invoiceSeries: string;
    invoiceNumber: number;
    createdAt: Date;
    verifactuQrData: string | null;
    verifactuHash: string | null;
    verifactuStatus: string;
  };
};

function fmtMoney(cents: number, currency: string): string {
  const val = (cents / 100).toFixed(2);
  return currency === "EUR" ? `${val} €` : `${val} ${currency}`;
}

function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat("es-ES", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return { r: 0.1, g: 0.1, b: 0.1 };
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return { r, g, b };
}

export async function buildInvoicePdf(input: PdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]); // A4 portrait (points)
  const { width, height } = page.getSize();

  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const brand = hexToRgb(input.tenant.brandColor);
  const brandColor = rgb(brand.r, brand.g, brand.b);
  const dark = rgb(0.1, 0.1, 0.12);
  const muted = rgb(0.45, 0.45, 0.5);
  const soft = rgb(0.85, 0.85, 0.88);

  const MARGIN = 50;
  let y = height - MARGIN;

  // ── Cabecera: nombre emisor (brand) ──
  const emitterName = input.tenant.legalName || input.tenant.name;
  page.drawText(emitterName, { x: MARGIN, y, size: 20, font: bold, color: brandColor });
  y -= 22;

  if (input.tenant.taxId) {
    page.drawText(`NIF: ${input.tenant.taxId}`, {
      x: MARGIN,
      y,
      size: 10,
      font: regular,
      color: muted,
    });
    y -= 14;
  }

  const addrLine1 = input.tenant.billingAddress || "";
  const addrLine2 = [
    input.tenant.billingPostalCode,
    input.tenant.billingCity,
    input.tenant.billingCountry,
  ]
    .filter(Boolean)
    .join(" · ");
  if (addrLine1) {
    page.drawText(addrLine1, { x: MARGIN, y, size: 9, font: regular, color: muted });
    y -= 12;
  }
  if (addrLine2) {
    page.drawText(addrLine2, { x: MARGIN, y, size: 9, font: regular, color: muted });
    y -= 12;
  }

  // ── Número factura + fecha (esquina derecha) ──
  const invoiceLabel = `${input.receipt.invoiceSeries}-${String(input.receipt.invoiceNumber).padStart(6, "0")}`;
  page.drawText("FACTURA SIMPLIFICADA", {
    x: width - MARGIN - 180,
    y: height - MARGIN,
    size: 10,
    font: bold,
    color: muted,
  });
  page.drawText(invoiceLabel, {
    x: width - MARGIN - 180,
    y: height - MARGIN - 18,
    size: 18,
    font: bold,
    color: dark,
  });
  page.drawText(fmtDate(input.receipt.createdAt), {
    x: width - MARGIN - 180,
    y: height - MARGIN - 36,
    size: 9,
    font: regular,
    color: muted,
  });

  y = Math.min(y, height - MARGIN - 60) - 20;

  // ── Separador ──
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: width - MARGIN, y },
    thickness: 0.5,
    color: soft,
  });
  y -= 24;

  // ── Receptor ──
  page.drawText("Cliente:", { x: MARGIN, y, size: 9, font: bold, color: muted });
  page.drawText(input.order.customerName || "Consumidor final", {
    x: MARGIN + 50,
    y,
    size: 10,
    font: regular,
    color: dark,
  });
  y -= 14;
  if (input.order.tableNumber) {
    page.drawText("Mesa:", { x: MARGIN, y, size: 9, font: bold, color: muted });
    page.drawText(input.order.tableNumber, {
      x: MARGIN + 50,
      y,
      size: 10,
      font: regular,
      color: dark,
    });
    y -= 14;
  }
  y -= 12;

  // ── Tabla items ──
  const COL_NAME = MARGIN;
  const COL_QTY = MARGIN + 280;
  const COL_UNIT = MARGIN + 330;
  const COL_TAX = MARGIN + 400;
  const COL_TOTAL = MARGIN + 460;

  page.drawText("Concepto", { x: COL_NAME, y, size: 9, font: bold, color: muted });
  page.drawText("Cant.", { x: COL_QTY, y, size: 9, font: bold, color: muted });
  page.drawText("Unit.", { x: COL_UNIT, y, size: 9, font: bold, color: muted });
  page.drawText(input.tenant.taxLabel, { x: COL_TAX, y, size: 9, font: bold, color: muted });
  page.drawText("Total", { x: COL_TOTAL, y, size: 9, font: bold, color: muted });
  y -= 6;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: width - MARGIN, y },
    thickness: 0.5,
    color: soft,
  });
  y -= 14;

  for (const it of input.items) {
    const nameText = it.name.length > 40 ? it.name.slice(0, 37) + "..." : it.name;
    page.drawText(nameText, { x: COL_NAME, y, size: 10, font: regular, color: dark });
    page.drawText(String(it.quantity), {
      x: COL_QTY,
      y,
      size: 10,
      font: regular,
      color: dark,
    });
    page.drawText(fmtMoney(it.unitPriceCents, input.order.currency), {
      x: COL_UNIT,
      y,
      size: 10,
      font: regular,
      color: dark,
    });
    page.drawText(`${it.taxRate}%`, {
      x: COL_TAX,
      y,
      size: 10,
      font: regular,
      color: dark,
    });
    page.drawText(fmtMoney(it.lineTotalCents, input.order.currency), {
      x: COL_TOTAL,
      y,
      size: 10,
      font: regular,
      color: dark,
    });
    y -= 14;
    if (it.notes) {
      page.drawText(`  ${it.notes}`, {
        x: COL_NAME + 6,
        y,
        size: 8,
        font: regular,
        color: muted,
      });
      y -= 12;
    }
  }

  y -= 8;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: width - MARGIN, y },
    thickness: 0.5,
    color: soft,
  });
  y -= 20;

  // ── Totales (derecha) ──
  const TOT_LABEL = width - MARGIN - 180;
  const TOT_VALUE = width - MARGIN - 10;

  page.drawText("Base imponible", {
    x: TOT_LABEL,
    y,
    size: 10,
    font: regular,
    color: muted,
  });
  page.drawText(fmtMoney(input.order.subtotalCents, input.order.currency), {
    x: TOT_VALUE - 80,
    y,
    size: 10,
    font: regular,
    color: dark,
  });
  y -= 16;

  page.drawText(input.tenant.taxLabel, {
    x: TOT_LABEL,
    y,
    size: 10,
    font: regular,
    color: muted,
  });
  page.drawText(fmtMoney(input.order.taxCents, input.order.currency), {
    x: TOT_VALUE - 80,
    y,
    size: 10,
    font: regular,
    color: dark,
  });
  y -= 20;

  page.drawText("Total", { x: TOT_LABEL, y, size: 13, font: bold, color: dark });
  page.drawText(fmtMoney(input.order.totalCents, input.order.currency), {
    x: TOT_VALUE - 80,
    y,
    size: 13,
    font: bold,
    color: brandColor,
  });

  // ── QR Verifactu (esquina inferior derecha) ──
  if (input.receipt.verifactuQrData) {
    try {
      const qrBuffer = await QRCode.toBuffer(input.receipt.verifactuQrData, {
        width: 140,
        errorCorrectionLevel: "M",
        margin: 1,
      });
      const qrImage = await pdf.embedPng(qrBuffer);
      const qrSize = 100;
      page.drawImage(qrImage, {
        x: width - MARGIN - qrSize,
        y: MARGIN + 20,
        width: qrSize,
        height: qrSize,
      });
      page.drawText("Verifactu", {
        x: width - MARGIN - qrSize,
        y: MARGIN + qrSize + 26,
        size: 8,
        font: bold,
        color: muted,
      });
      page.drawText("Escanea para verificar con AEAT", {
        x: width - MARGIN - qrSize,
        y: MARGIN + qrSize + 14,
        size: 7,
        font: regular,
        color: muted,
      });
    } catch {
      // Si QR falla, seguimos con PDF sin QR — mejor PDF parcial que crash.
    }
  }

  // ── Footer: huella + status ──
  if (input.receipt.verifactuHash) {
    page.drawText(`Huella: ${input.receipt.verifactuHash.slice(0, 64)}`, {
      x: MARGIN,
      y: MARGIN + 20,
      size: 7,
      font: regular,
      color: muted,
    });
  }
  page.drawText(`Estado Verifactu: ${input.receipt.verifactuStatus}`, {
    x: MARGIN,
    y: MARGIN + 10,
    size: 7,
    font: regular,
    color: muted,
  });

  if (input.order.notes) {
    page.drawText(`Notas: ${input.order.notes.slice(0, 100)}`, {
      x: MARGIN,
      y: MARGIN + 30,
      size: 8,
      font: regular,
      color: muted,
    });
  }

  return await pdf.save();
}
