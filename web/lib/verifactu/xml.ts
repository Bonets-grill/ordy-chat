// web/lib/verifactu/xml.ts — Construcción del XML RegistroFactura (Verifactu).
//
// Esta es una versión MÍNIMA VIABLE del XML de alta de una factura. La spec
// real AEAT (Orden HAC/1177/2024) tiene ~50 campos opcionales. Aquí cubrimos
// el caso simple del mesero digital (factura simplificada B2C de hostelería):
//
// - Un destinatario final (comensal) sin NIF
// - Un emisor con NIF + razón social
// - Una o varias líneas con tipo IVA
// - Exento IRPF, sin retenciones ni recargos
//
// El XML no está firmado aún; firma con lib/verifactu/sign.ts antes de enviar.
// Cuando el tenant amplíe casos (facturas B2B completas, rectificativas, etc.)
// aquí es donde se enriquece.

export type InvoiceXmlInput = {
  emisor: {
    nif: string;
    razonSocial: string;
  };
  invoiceSeries: string;
  invoiceNumber: number;
  fechaExpedicion: Date;
  tipoFactura: "F1" | "F2";  // F1 = factura completa, F2 = simplificada
  descripcion: string;
  lineas: Array<{
    baseImponible: number;   // euros, 2 decimales
    tipoImpositivo: number;  // ej: 10 para 10%
    cuotaIva: number;        // euros
  }>;
  importeTotal: number;      // euros
  cuotaTotalIva: number;     // euros
  huellaActual: string;
  huellaAnterior: string;    // "" si es la primera
  fechaHoraGenRegistro: string; // ISO-8601 con zona
};

export function buildRegistroFacturaXml(input: InvoiceXmlInput): string {
  const fecha = formatDate(input.fechaExpedicion);
  const desglose = input.lineas
    .map(
      (ln) => `
        <sf:DetalleDesglose>
          <sf:Impuesto>01</sf:Impuesto>
          <sf:ClaveRegimen>01</sf:ClaveRegimen>
          <sf:CalificacionOperacion>S1</sf:CalificacionOperacion>
          <sf:TipoImpositivo>${ln.tipoImpositivo.toFixed(2)}</sf:TipoImpositivo>
          <sf:BaseImponibleOimporteNoSujeto>${ln.baseImponible.toFixed(2)}</sf:BaseImponibleOimporteNoSujeto>
          <sf:CuotaRepercutida>${ln.cuotaIva.toFixed(2)}</sf:CuotaRepercutida>
        </sf:DetalleDesglose>`,
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<sum:RegFactuSistemaFacturacion xmlns:sum="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd" xmlns:sf="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd">
  <sum:Cabecera>
    <sf:ObligadoEmision>
      <sf:NombreRazon>${escapeXml(input.emisor.razonSocial)}</sf:NombreRazon>
      <sf:NIF>${input.emisor.nif}</sf:NIF>
    </sf:ObligadoEmision>
  </sum:Cabecera>
  <sum:RegistroFactura>
    <sum:RegistroAlta>
      <sf:IDVersion>1.0</sf:IDVersion>
      <sf:IDFactura>
        <sf:IDEmisorFactura>${input.emisor.nif}</sf:IDEmisorFactura>
        <sf:NumSerieFactura>${input.invoiceSeries}${input.invoiceNumber}</sf:NumSerieFactura>
        <sf:FechaExpedicionFactura>${fecha}</sf:FechaExpedicionFactura>
      </sf:IDFactura>
      <sf:NombreRazonEmisor>${escapeXml(input.emisor.razonSocial)}</sf:NombreRazonEmisor>
      <sf:TipoFactura>${input.tipoFactura}</sf:TipoFactura>
      <sf:DescripcionOperacion>${escapeXml(input.descripcion)}</sf:DescripcionOperacion>
      <sf:Desglose>${desglose}
      </sf:Desglose>
      <sf:CuotaTotal>${input.cuotaTotalIva.toFixed(2)}</sf:CuotaTotal>
      <sf:ImporteTotal>${input.importeTotal.toFixed(2)}</sf:ImporteTotal>
      <sf:Encadenamiento>${
        input.huellaAnterior
          ? `<sf:RegistroAnterior><sf:Huella>${input.huellaAnterior}</sf:Huella></sf:RegistroAnterior>`
          : `<sf:PrimerRegistro>S</sf:PrimerRegistro>`
      }</sf:Encadenamiento>
      <sf:SistemaInformatico>
        <sf:NombreRazon>Ordy Chat</sf:NombreRazon>
        <sf:NIF>000000000</sf:NIF>
        <sf:NombreSistemaInformatico>Ordy Chat</sf:NombreSistemaInformatico>
        <sf:IdSistemaInformatico>01</sf:IdSistemaInformatico>
        <sf:Version>1.0</sf:Version>
        <sf:NumeroInstalacion>001</sf:NumeroInstalacion>
      </sf:SistemaInformatico>
      <sf:FechaHoraHusoGenRegistro>${input.fechaHoraGenRegistro}</sf:FechaHoraHusoGenRegistro>
      <sf:TipoHuella>01</sf:TipoHuella>
      <sf:Huella>${input.huellaActual}</sf:Huella>
    </sum:RegistroAlta>
  </sum:RegistroFactura>
</sum:RegFactuSistemaFacturacion>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatDate(d: Date): string {
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${day}-${month}-${d.getFullYear()}`;
}
