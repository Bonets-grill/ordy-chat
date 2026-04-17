// web/lib/fiscal/certificate.ts — Parsing y validación de certificados PKCS#12.
//
// Cada tenant sube su propio .p12/.pfx con la clave pública + privada que usará
// para firmar registros Verifactu ante la AEAT. Aquí lo validamos y extraemos
// metadatos (CN, emisor, fecha expiración) pero NO ejecutamos la firma aún —
// eso vive en lib/verifactu/sign.ts.
//
// La clave privada SOLO se descifra en memoria al momento de firmar. En la DB
// guardamos el .p12 completo cifrado + la password cifrada (ambos AES-256-GCM).

import forge from "node-forge";

export type CertificateInfo = {
  subjectCommonName: string;
  issuerCommonName: string;
  serialNumber: string;
  notBefore: Date;
  notAfter: Date;
  /** True si la key privada se pudo extraer con la password dada. */
  hasPrivateKey: boolean;
};

export class InvalidCertificateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidCertificateError";
  }
}

/**
 * Parsea un .p12/.pfx y devuelve metadatos. Lanza InvalidCertificateError si:
 * - El formato es inválido
 * - La password no descifra el contenedor
 * - No hay una pareja cert + clave privada utilizable
 */
export function parsePkcs12(p12Bytes: Buffer, password: string): CertificateInfo {
  let p12Asn1: forge.asn1.Asn1;
  try {
    const der = forge.util.createBuffer(p12Bytes.toString("binary"));
    p12Asn1 = forge.asn1.fromDer(der);
  } catch (err) {
    throw new InvalidCertificateError("El archivo no es un .p12/.pfx válido");
  }

  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, password);
  } catch (err) {
    throw new InvalidCertificateError("Contraseña incorrecta o contenedor dañado");
  }

  // Extraer cert del primer bag de tipo certBag
  let cert: forge.pki.Certificate | null = null;
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
  const bagList = certBags[forge.pki.oids.certBag];
  if (bagList && bagList[0]?.cert) {
    cert = bagList[0].cert;
  }

  // Extraer clave privada (pkcs8ShroudedKeyBag o keyBag)
  let hasKey = false;
  const shroudedBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
  const shroudedList = shroudedBags[forge.pki.oids.pkcs8ShroudedKeyBag];
  if (shroudedList && shroudedList[0]?.key) hasKey = true;
  if (!hasKey) {
    const keyBags = p12.getBags({ bagType: forge.pki.oids.keyBag });
    const keyList = keyBags[forge.pki.oids.keyBag];
    if (keyList && keyList[0]?.key) hasKey = true;
  }

  if (!cert) {
    throw new InvalidCertificateError("El .p12 no contiene un certificado X.509");
  }
  if (!hasKey) {
    throw new InvalidCertificateError("El .p12 no contiene clave privada utilizable");
  }

  const subjectCN = cert.subject.getField("CN")?.value ?? "(sin CN)";
  const issuerCN = cert.issuer.getField("CN")?.value ?? "(sin CN)";

  return {
    subjectCommonName: String(subjectCN),
    issuerCommonName: String(issuerCN),
    serialNumber: cert.serialNumber,
    notBefore: cert.validity.notBefore,
    notAfter: cert.validity.notAfter,
    hasPrivateKey: hasKey,
  };
}

/** ¿Expira en menos de N días? Útil para alertar al tenant. */
export function expiresWithinDays(info: CertificateInfo, days: number): boolean {
  const ms = info.notAfter.getTime() - Date.now();
  return ms < days * 24 * 60 * 60 * 1000;
}
