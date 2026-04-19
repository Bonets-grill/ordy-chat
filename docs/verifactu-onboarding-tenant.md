# Verifactu — guía para el dueño del local

**Qué es Verifactu**: sistema de la Agencia Tributaria (AEAT) que exige registrar electrónicamente cada factura/recibo que emite tu negocio en España. Es **obligatorio desde el 1 de enero de 2026** (Real Decreto 1007/2023) para todos los autónomos y empresas que emitan facturas con software (incluido un TPV, una caja registradora digital, o en nuestro caso, Ordy Chat).

Si tu local emite tickets o facturas a clientes → tienes que activar Verifactu.

---

## En qué consiste en la práctica

Cada pedido pagado en tu local genera un recibo. Ordy Chat:
1. Calcula base imponible + IVA + total.
2. Asigna número secuencial (serie A, número 1, 2, 3…).
3. Firma el registro con tu certificado digital.
4. Lo envía cifrado a AEAT en tiempo real.
5. Genera un PDF con QR Verifactu que el cliente puede escanear para comprobar la validez ante Hacienda.

Tú no haces nada manual. Solo hay que configurarlo una vez.

---

## Paso 1 — Conseguir tu certificado digital

Verifactu funciona con un certificado digital que identifica a tu empresa (como un DNI electrónico pero para facturación). Tienes tres opciones:

### Opción A — Certificado FNMT (gratis, más común)

1. Entra en [sede.fnmt.gob.es](https://www.sede.fnmt.gob.es/certificados/persona-fisica/obtener-certificado-software).
2. Elige "Obtener Certificado" → "Persona física" (si eres autónomo) o "Representante Persona Jurídica" (si tienes SL/SA).
3. Genera la solicitud desde un ordenador (te dan un código).
4. Acude a una oficina de acreditación (Hacienda, Seguridad Social) con el código y tu DNI en persona.
5. Vuelve al ordenador y descarga el certificado.

**Tiempo total: 1-3 días hábiles**. Coste: gratis.

### Opción B — Camerfirma (de pago, más rápido)

- Precio: ~30-50€/año.
- Entrega 24-48h, sin cita presencial obligatoria.
- Válido igual que FNMT.
- Web: [camerfirma.com](https://www.camerfirma.com).

### Opción C — Certificado de tu gestoría

Si ya tienes gestor que hace tus facturas, puede que te dé acceso a un certificado que ellos tienen. Pregúntale: "¿tenéis mi certificado digital de empresa? Lo necesito para activar la facturación electrónica en AEAT".

---

## Paso 2 — Exportar el certificado a formato .p12 (PKCS12)

El certificado que descargas de FNMT viene normalmente como archivo `.pfx` o `.p12`. Ordy Chat los acepta ambos (son el mismo formato).

Si te instalaron el certificado en el navegador (no te dieron archivo):
1. **Chrome/Edge** → Configuración → Privacidad y seguridad → Seguridad → Administrar certificados → Personal → selecciona tu cert → **Exportar** → marca "Exportar la clave privada" → formato **.PFX** → pon una contraseña que recuerdes → guarda el archivo.
2. **Firefox** → Preferencias → Privacidad y seguridad → Certificados → Ver certificados → Sus certificados → selecciona → **Hacer copia**.

**Importante**: la contraseña que le pones al exportar la usarás en Ordy Chat. Guárdala bien.

---

## Paso 3 — Subir el certificado en Ordy Chat

1. Entra en tu panel → **Datos fiscales** (`/agent/fiscal`).
2. Rellena primero los datos fiscales: razón social, NIF, dirección fiscal, código postal, ciudad, serie de facturación (déjalo en "A" si no tienes otra).
3. Baja hasta la sección **Verifactu**.
4. Pulsa **Subir certificado**.
5. Selecciona tu archivo `.p12` o `.pfx`.
6. Introduce la contraseña del certificado.
7. Ordy Chat lo cifra con AES-256-GCM antes de guardarlo. **Nadie del equipo de Ordy puede ver tu certificado ni tu contraseña**.

---

## Paso 4 — Activar Verifactu

Primero en modo **sandbox** (pruebas, no afecta a AEAT real):

1. En la sección Verifactu, elige entorno **Sandbox**.
2. Activa el toggle **Verifactu activo**.
3. Haz un pedido de prueba pequeño (ej. "café 1.50€") desde tu móvil por WhatsApp al agente.
4. Marca el pedido como pagado.
5. Revisa que en `/agent/fiscal` aparece un recibo con estado **Aceptado**.
6. Descarga el PDF y verifica que tiene QR.

Cuando funcione en sandbox:

7. Cambia a entorno **Production**.
8. A partir de ese momento, cada pedido pagado genera un registro real en AEAT. Mira durante la primera semana que los recibos salgan **Aceptados** y no **Error**.

---

## Estados de los recibos y qué hacer

| Estado | Qué significa | Qué hacer |
|---|---|---|
| **Aceptado** | AEAT recibió y aprobó el registro | Nada. Todo correcto. |
| **Aceptado con errores** | AEAT lo registró pero detectó inconsistencia menor (ej: NIF del cliente mal escrito pero importe correcto) | Nada urgente. Revisa el detalle por si hace falta rectificar en el próximo pedido. |
| **Rechazado** | AEAT no aceptó el registro (datos fiscales erróneos) | Revisa que tu NIF, razón social y dirección en datos fiscales estén correctos. Contacta si persiste. |
| **Error** | Fallo técnico (AEAT caído, timeout, cert expirado) | Ordy Chat reintenta automáticamente 3 veces en las siguientes horas. Si sigue en error tras 24h, revisa: (a) cert no expirado, (b) estado de AEAT en [agenciatributaria.es/avisos](https://www.agenciatributaria.gob.es). |
| **Error permanente** | Ordy agotó los 3 reintentos | Requiere tu intervención. Entra en /agent/fiscal y pulsa "Reintentar" manualmente. Si persiste: revisa si AEAT ha hecho cambios en XSD. |
| **Omitido** | Verifactu no está activo o el pedido está exento | Si no emites factura (ej: propina interna), está bien. Si esperabas factura, activa Verifactu. |

---

## Alerta de certificado que va a expirar

Tu certificado FNMT/Camerfirma **caduca cada 2-4 años**. Ordy Chat te avisa con **30 días de antelación** en el panel `/agent/fiscal` y por email. Renueva con tiempo — si expira, los registros Verifactu fallan automáticamente hasta que subas uno nuevo.

---

## Preguntas frecuentes

### ¿Tengo que emitir factura a todos los clientes?

No. En hostelería, si el cliente no la pide, no es obligatorio emitir factura nominativa — pero sí es obligatorio emitir **ticket/recibo simplificado** (y ese también va a Verifactu). Ordy Chat emite siempre recibo simplificado por defecto.

Si el cliente pide factura con NIF → el agente puede preguntarle el NIF + razón social por WhatsApp y la emite nominativa.

### ¿Y si mi local emite <3000 facturas al año?

Verifactu es obligatorio igualmente. No hay umbral mínimo. La única excepción: empresas bajo régimen SII (facturación alta, >6M€/año) que ya envían sus libros de IVA a AEAT — esos no necesitan Verifactu, usan SII.

### ¿Qué pasa con las propinas?

Las propinas **no forman parte de la factura**. Ordy Chat las registra aparte para tus informes internos pero no las envía a Verifactu.

### ¿Y si estoy en Canarias/Ceuta/Melilla?

Canarias usa IGIC en vez de IVA, y no aplica Verifactu (aún). Ceuta y Melilla aplican IPSI. Ordy Chat detecta tu región fiscal y solo envía a AEAT los recibos de la península + Baleares.

**País Vasco y Navarra**: tienen su propio sistema, **TicketBAI**, obligatorio desde antes. Ordy Chat todavía no integra TicketBAI (Q3 2026 en roadmap). Si tu local está en esas comunidades, contáctanos.

### ¿Puedo usar el mismo certificado que uso para presentar el IRPF?

Sí, si es un certificado de persona física (autónomo) o representante persona jurídica. Es el mismo formato.

### ¿Ordy Chat ve mis datos fiscales?

**Certificado y contraseña están cifrados** con AES-256-GCM. La clave de cifrado vive en el servidor y no es extraíble por el equipo. Los datos de tus clientes (NIF cuando piden factura) sí son accesibles en tu panel, pero no se comparten con terceros fuera de AEAT y tu cliente.

---

## Si algo falla: contacto

Email: soporte@ordychat.com con asunto "Verifactu" + tu slug de tenant. Respondemos en <24h laborables.
