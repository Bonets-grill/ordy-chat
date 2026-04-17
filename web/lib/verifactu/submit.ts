// web/lib/verifactu/submit.ts — Envía el XML al endpoint AEAT con mTLS.
//
// AEAT exige mTLS (cliente autenticado con su propio certificado). Node 18+
// soporta esto nativamente con https.Agent({ cert, key }).

import https from "node:https";
import { URL } from "node:url";

const ENDPOINTS = {
  sandbox: "https://prewww1.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP",
  production: "https://www1.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP",
} as const;

export type SubmitResult = {
  statusCode: number;
  responseBody: string;
  acknowledged: boolean;      // true si AEAT respondió "Correcto"/"AceptadoConErrores"
  rejectionReason?: string;
};

export type SubmitOptions = {
  environment: "sandbox" | "production";
  certPem: string;
  privateKeyPem: string;
  xmlPayload: string;
};

export async function submitRegistroFactura(opts: SubmitOptions): Promise<SubmitResult> {
  const url = new URL(ENDPOINTS[opts.environment]);

  const agent = new https.Agent({
    cert: opts.certPem,
    key: opts.privateKeyPem,
    rejectUnauthorized: true,
  });

  const soapEnvelope = buildSoapEnvelope(opts.xmlPayload);

  const response = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "text/xml; charset=utf-8",
          SOAPAction: '""',
          "Content-Length": Buffer.byteLength(soapEnvelope),
        },
        agent,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          resolve({ statusCode: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") });
        });
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.setTimeout(30_000, () => {
      req.destroy(new Error("aeat_timeout"));
    });
    req.write(soapEnvelope);
    req.end();
  });

  const acknowledged = response.statusCode >= 200 && response.statusCode < 300 && /Correcto|Aceptad/i.test(response.body);

  return {
    statusCode: response.statusCode,
    responseBody: response.body,
    acknowledged,
    rejectionReason: acknowledged ? undefined : extractRejectionReason(response.body),
  };
}

function buildSoapEnvelope(innerXml: string): string {
  // El innerXml ya viene con su propia declaración XML; la quitamos para
  // embeberla dentro del sobre SOAP sin duplicar.
  const stripped = innerXml.replace(/^<\?xml[^>]*\?>\s*/, "");
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Header/>
  <soapenv:Body>${stripped}</soapenv:Body>
</soapenv:Envelope>`;
}

function extractRejectionReason(body: string): string {
  const match = body.match(/<(?:ns\d*:)?DescripcionErrorRegistro[^>]*>([^<]+)</i);
  if (match) return match[1];
  const fault = body.match(/<(?:ns\d*:)?faultstring[^>]*>([^<]+)</i);
  if (fault) return fault[1];
  return "respuesta desconocida";
}
