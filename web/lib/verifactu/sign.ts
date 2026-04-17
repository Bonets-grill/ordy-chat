// web/lib/verifactu/sign.ts — Firma XAdES-EPES del XML Verifactu.
//
// La AEAT acepta (en Verifactu) el envío por HTTPS con mTLS del certificado
// del emisor. NO requiere firma XAdES incrustada como en SII — basta con TLS
// cliente autenticando al emisor. Aquí preparamos:
//
//  1. Extraer cert PEM + clave privada PEM del .p12
//  2. Devolver ambos para que submit.ts los use en el mTLS TLS handshake
//
// Si en el futuro el procedimiento cambia (AEAT lo ha hecho varias veces),
// aquí se añade la firma XAdES-EPES con xml-crypto.

import forge from "node-forge";

export type SigningMaterial = {
  certPem: string;       // certificado X.509 en PEM
  privateKeyPem: string; // clave privada RSA en PEM
};

/**
 * Descifra el .p12 en memoria y devuelve el par cert+key en PEM.
 * Nunca persistas el resultado — solo úsalo en el momento del envío y
 * deja que el GC lo libere.
 */
export function extractSigningMaterial(p12Bytes: Buffer, password: string): SigningMaterial {
  const der = forge.util.createBuffer(p12Bytes.toString("binary"));
  const p12Asn1 = forge.asn1.fromDer(der);
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, password);

  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
  const certBag = certBags[forge.pki.oids.certBag]?.[0];
  if (!certBag?.cert) throw new Error("no_cert_in_p12");

  let keyBag;
  const shrouded = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
  keyBag = shrouded[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0];
  if (!keyBag?.key) {
    const keyBags = p12.getBags({ bagType: forge.pki.oids.keyBag });
    keyBag = keyBags[forge.pki.oids.keyBag]?.[0];
  }
  if (!keyBag?.key) throw new Error("no_key_in_p12");

  const certPem = forge.pki.certificateToPem(certBag.cert);
  const privateKeyPem = forge.pki.privateKeyToPem(keyBag.key);

  return { certPem, privateKeyPem };
}
