# Spec — Verifactu finalización
**Fecha:** 2026-04-19
**Autor:** Claude
**Estado:** DRAFT — espera brainstorming con Mario antes de the-architect

---

## Contexto

Verifactu/TicketBAI es obligatorio en España desde enero 2026 para cualquier emisor de facturas (RD 1007/2023). Ya llevamos ~4 meses de compliance debt si algún tenant está emitiendo recibos.

**Buenas noticias (auditoría 2026-04-19)**: el 80% de la infra YA existe:
- `web/lib/verifactu/` (submit mTLS a AEAT sandbox+prod, XML registro, huella chain-link, QR, sign)
- `web/lib/fiscal/certificate.ts` (parser PKCS12)
- `web/lib/receipts.ts` wired al Stripe webhook
- `web/app/api/fiscal/verifactu/route.ts` (toggle + upload)
- `web/app/agent/fiscal/page.tsx` (UI setup)
- Schema `tenant_fiscal_config` + `receipts` con toda la metadata Verifactu

**Lo que falta**: testing end-to-end, PDF legal, monitor operacional, playbook.

## Objetivo

Llevar Verifactu de "80% construido, 0% validado" a "100% validado + monitoreable + documentado" para que podamos prometer "emisión legal España" en el pricing Pro sin estar mintiendo.

## Scope (3 fases)

### Fase 1 · Testing E2E contra AEAT sandbox [3 días]

**Por qué primero**: no podemos prometer Verifactu si no hemos visto un registro aceptado por AEAT de verdad. Cualquier feature adicional sin esto es castillo de naipes.

**Tareas**:
1. Obtener certificado digital de prueba AEAT (sandbox). Mario necesita solicitarlo.
2. Setup sandbox tenant en Neon con `verifactuEnabled=true`, `verifactuEnvironment='sandbox'`.
3. Generar 5 orders de prueba con distintos escenarios: 1 item, múltiples items, alergias en notes, totalCents con decimales, pedido con descuento.
4. Ejecutar `processReceiptForOrder` contra cada uno. Capturar respuesta AEAT literal.
5. Verificar: huella chain-link correcta, QR decodificable con app oficial, XML valida contra XSD AEAT.
6. Documentar en `docs/verifactu-e2e-evidence-2026-XX-XX.md` con evidencia literal.
7. Si falla: diagnosticar en `submit.ts` / `xml.ts` / `hash.ts` (ya hay tests unitarios? chequear).

**Entregable**: evidencia de respuesta AEAT "AceptadoConErrores" o "Correcto" para los 5 casos.

### Fase 2 · PDF factura legal con QR Verifactu [5 días]

**Por qué**: AEAT exige que el cliente reciba una factura en PDF con:
- Número de factura + serie
- Fecha emisión
- Datos emisor (NIF, nombre, dirección fiscal)
- Datos receptor (si aplica — en hostelería a menudo "consumidor final")
- Desglose impositivo (base imponible + IVA + total)
- Código QR Verifactu (nuevo requisito)
- Huella/hash Verifactu (pie de página)

**Tareas**:
1. Dependencia: `pdfkit` o `react-pdf/renderer` (evaluar peso bundle).
2. `web/lib/receipts/pdf.ts` — función `buildInvoicePdf(order, receipt, tenant)` retorna `Buffer`.
3. Template con logo tenant (opcional, `tenants.logo_url`) + datos legales.
4. QR generado con `qrcode` npm a partir de `receipt.verifactuQrData`.
5. Storage: Vercel Blob (ya tenemos token) con path `invoices/{tenantSlug}/{year}/{invoiceSeries}-{invoiceNumber}.pdf`.
6. `receipts.pdfUrl` se setea con la URL firmada temporal.
7. Email al cliente: adjuntar PDF (ya hay `lib/email.ts` con Resend).
8. Test: generar PDF, abrirlo manualmente, verificar QR escaneable.

**Entregable**: email con PDF adjunto conteniendo QR Verifactu válido.

### Fase 3 · Monitor operacional + playbook [3 días]

**Por qué**: si un receipt queda en `status='error'`, nadie se entera. Tenant acumula compliance debt sin saberlo.

**Tareas**:
1. UI `/agent/fiscal` actualmente muestra toggle. Extender con:
   - Contador receipts por status (accepted/rejected/error/skipped).
   - Lista últimos 20 receipts con fecha, invoice_series/number, status, botón "Reintentar" si error.
   - Alerta roja si >3 errores en últimas 24h.
2. Endpoint `POST /api/fiscal/verifactu/retry/[receiptId]` — re-ejecuta processReceiptForOrder para un receipt en error.
3. Cron `/api/cron/verifactu-retry` (hourly) — auto-retry receipts en error <24h vieja (transitory AEAT errors). Max 3 retries, luego marca `error_permanent`.
4. Alerta email al tenant admin si `error_permanent` o >5 errors/24h.
5. Playbook `docs/verifactu-onboarding-tenant.md`:
   - Cómo solicitar certificado digital FNMT/Camerfirma.
   - Cómo exportar a PKCS12 (.p12) con password.
   - Cómo subirlo en /agent/fiscal.
   - Qué hacer si AEAT rechaza (códigos de error comunes).

**Entregable**: tenant que sube mal cert lo sabe en 5 min con mensaje claro; tenant con receipt en error tiene UI para reintentar o escalar.

## No-goals (fuera de scope)

- TicketBAI (País Vasco) — scope separado, requiere integración con las 3 diputaciones. Siguiente sprint si hay tenants en Euskadi.
- Retenciones IRPF — no aplica a hostelería B2C.
- Facturación recurrente (abonos/rectificativas) — aún no generamos ninguna.
- Integración con software contable del tenant (a3, Sage, Holded) — fuera scope; si piden, export CSV.

## Estimación

- Fase 1: 3 días (principalmente Mario gestionando el cert sandbox).
- Fase 2: 5 días (PDF complexity + templates legal).
- Fase 3: 3 días.
- **Total: 11 días con buffer = 2-3 sprints**.

## Dependencias externas

- Certificado digital AEAT sandbox (Mario solicita a FNMT, gratis).
- Blob storage Vercel (ya configurado con `BLOB_READ_WRITE_TOKEN`?).
- `qrcode` + `pdfkit` npm (nuevas deps, peso ~200KB).

## Riesgos

- **AEAT sandbox caídos intermitente** — mockear fallbacks, no bloquear desarrollo.
- **XSD AEAT actualizado post-lanzamiento** — subscribirse a notificaciones AEAT.
- **Cert tenant expira sin aviso** — ya tenemos `certificateExpiresAt` en schema; UI debe avisar 30 días antes.
- **Timeline legal**: estamos ya en infracción si algún tenant emite. Mitigación inmediata: desactivar emisión de receipts hasta Fase 1 completa, comunicar a tenants afectados.

## Siguiente acción

Brainstorming con Mario sobre:
1. ¿Hay tenants ya emitiendo receipts en prod sin Verifactu activo? → urgencia de Fase 1 sube.
2. ¿Tenemos certificado sandbox AEAT ya o hay que pedirlo? → bloqueador Fase 1.
3. ¿PDFKit vs react-pdf? → Mario's call (dev familiarity).
4. ¿Aprobar este spec para pasar a the-architect blueprint?
