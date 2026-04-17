// web/lib/verifactu/qr.ts — Genera el código QR de Verifactu según RD 1007/2023.
//
// La AEAT exige que cada factura lleve un QR con una URL de consulta que
// contiene: NIF del emisor, serie+número, fecha, importe total y un hash.
//
// Spec oficial (Orden HAC/1177/2024, anexo II) — el formato de la URL es:
//   https://prewww2.aeat.es/.../ValidarQR?nif={nif}&numserie={numserie}&fecha={fecha}&importe={importe}
// En producción cambia el host a www2.aeat.es y el path al de producción.

export type QrPayload = {
  nif: string;                 // NIF del tenant emisor
  invoiceSeries: string;
  invoiceNumber: string | number;
  invoiceDate: Date;            // fecha de emisión
  totalAmount: number;          // total en euros (con decimales, NO cents)
  environment: "sandbox" | "production";
};

const AEAT_HOSTS = {
  sandbox: "https://prewww2.aeat.es",
  production: "https://www2.aeat.es",
} as const;

const VERIFACTU_PATH = "/wlpl/TIKE-CONT/ValidarQR";

export function buildVerifactuUrl(p: QrPayload): string {
  const fecha = formatDateDDMMYYYY(p.invoiceDate);
  const numserie = `${p.invoiceSeries}${p.invoiceNumber}`;
  const importe = p.totalAmount.toFixed(2);
  const qs = new URLSearchParams({
    nif: p.nif,
    numserie,
    fecha,
    importe,
  });
  return `${AEAT_HOSTS[p.environment]}${VERIFACTU_PATH}?${qs.toString()}`;
}

function formatDateDDMMYYYY(d: Date): string {
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${day}-${month}-${d.getFullYear()}`;
}

/**
 * Genera el PNG del QR como data URL (base64) listo para meter en un <img src>.
 * Se usa la librería `qrcode` (dep estándar en el stack). Si aún no está instalada,
 * el consumidor hará dynamic import y capturará el error.
 */
export async function renderQrPng(url: string): Promise<string> {
  const qrcode = (await import("qrcode")).default;
  return qrcode.toDataURL(url, { errorCorrectionLevel: "M", margin: 1, width: 200 });
}
