// web/lib/verifactu/hash.ts — Huella encadenada de registros Verifactu.
//
// Cada registro de facturación se encadena con el anterior mediante un hash
// SHA-256 sobre campos clave del registro + huella previa (salvo el primero).
// Esto garantiza que la cadena de facturas de un tenant es inmanipulable.
//
// Spec oficial (Orden HAC/1177/2024, anexo III): campos concatenados con "&":
//   IDEmisorFactura + NumSerieFactura + FechaExpedicionFactura + TipoFactura +
//   CuotaTotal + ImporteTotal + Huella[anterior] + FechaHoraHusoGenRegistro
//
// El resultado se codifica en hex mayúsculas (spec AEAT).

import { createHash } from "node:crypto";

export type HuellaInput = {
  emisorNif: string;
  serieNumero: string;      // ej: "A-1234"
  fechaExpedicion: string;  // dd-mm-yyyy
  tipoFactura: string;      // "F1" (factura), "R1" (rectificativa), etc.
  cuotaTotal: string;       // importe IVA "0.00" (2 decimales punto)
  importeTotal: string;     // total "0.00"
  huellaAnterior: string;   // hex de la factura anterior, "" si es la primera
  fechaHoraGenRegistro: string; // ISO-8601 con zona: "2026-04-17T12:34:56+02:00"
};

export function computeHuella(input: HuellaInput): string {
  const parts = [
    `IDEmisorFactura=${input.emisorNif}`,
    `NumSerieFactura=${input.serieNumero}`,
    `FechaExpedicionFactura=${input.fechaExpedicion}`,
    `TipoFactura=${input.tipoFactura}`,
    `CuotaTotal=${input.cuotaTotal}`,
    `ImporteTotal=${input.importeTotal}`,
    `Huella=${input.huellaAnterior}`,
    `FechaHoraHusoGenRegistro=${input.fechaHoraGenRegistro}`,
  ].join("&");
  return createHash("sha256").update(parts, "utf8").digest("hex").toUpperCase();
}
