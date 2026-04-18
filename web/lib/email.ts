// web/lib/email.ts — Emails transaccionales con branding Ordy Chat.
//
// Un único helper para TODOS los emails del producto: magic link, bienvenida,
// avisos de trial, notificaciones, alertas. Garantiza consistencia visual.
//
// Stripe envía sus propias facturas/recibos con su template — ahí solo se
// configura branding desde Stripe Dashboard → Settings → Branding (logo,
// accent color #7c3aed, business name). Ver docs/STRIPE_BRANDING.md.

const DEFAULT_BRAND = "#7c3aed";
const DEFAULT_ACCENT = "#ec4899";

type ButtonSpec = { label: string; href: string };

export type BrandOverride = {
  /** Color primario del card (CTA + banda + logo). Fallback al violeta Ordy. */
  primary?: string;
  /** Texto de la marca en el header. */
  name?: string;
  /** Logo URL (si se pasa, reemplaza el cuadrado "O"). */
  logoUrl?: string;
};

export type BrandedEmailOptions = {
  /** Pre-header / título grande dentro del card. */
  title: string;
  /** Párrafos del cuerpo. Soportan HTML básico (<strong>, <em>, <a>). */
  paragraphs: string[];
  /** CTA principal (opcional). */
  button?: ButtonSpec;
  /** HTML extra (tabla de líneas, QR Verifactu, etc). Va ANTES del CTA. */
  extraHtml?: string;
  /** Texto pequeño bajo el CTA (ej. "¿No fuiste tú? Ignora este correo"). */
  footerNote?: string;
  /** Email destino — se muestra en el footer. */
  recipient?: string;
  /** Override de colores/logo por tenant (para recibos de comensal). */
  brand?: BrandOverride;
  /** Nota extra al pie (razón social + NIF del emisor, por ej.). */
  legalFooter?: string;
};

export type SendBrandedEmailInput = BrandedEmailOptions & {
  to: string;
  subject: string;
  /** Texto plano alternativo. Si se omite, se deriva de paragraphs. */
  text?: string;
};

/**
 * Renderiza HTML con el card de Ordy Chat (banda superior, logo, contenido,
 * CTA bulletproof, fallback link, footer).
 * Pattern table-based — funciona en Gmail, Outlook, Apple Mail.
 */
export function renderBrandedEmail(opts: BrandedEmailOptions): string {
  const { title, paragraphs, button, extraHtml, footerNote, recipient, legalFooter } = opts;
  const brand = opts.brand?.primary ?? DEFAULT_BRAND;
  const brandDark = darken(brand);
  const brandName = opts.brand?.name ?? "Ordy Chat";
  const logoUrl = opts.brand?.logoUrl;

  const bodyHtml = paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:#4b5563;">${p}</p>`,
    )
    .join("");

  const buttonHtml = button
    ? `
        <tr>
          <td align="left" style="padding:8px 40px 8px 40px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="center" bgcolor="${brand}" style="background-color:${brand};border-radius:10px;">
                  <a href="${button.href}" target="_blank" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;border:1px solid ${brandDark};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;mso-padding-alt:0;">
                    <!--[if mso]>&nbsp;&nbsp;&nbsp;&nbsp;<![endif]-->${button.label}<!--[if mso]>&nbsp;&nbsp;&nbsp;&nbsp;<![endif]-->
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 40px 8px 40px;">
            <p style="margin:0 0 8px 0;font-size:13px;line-height:1.5;color:#6b7280;">¿El botón no funciona? Copia y pega este enlace en tu navegador:</p>
            <p style="margin:0;font-size:12px;line-height:1.5;color:${brand};word-break:break-all;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;">${button.href}</p>
          </td>
        </tr>`
    : "";

  const extraHtmlRow = extraHtml ? `<tr><td style="padding:0 40px 16px 40px;">${extraHtml}</td></tr>` : "";
  const legalFooterHtml = legalFooter
    ? `<p style="margin:8px 0 0 0;font-size:11px;line-height:1.4;color:#9ca3af;">${legalFooter}</p>`
    : "";

  const noteHtml = footerNote
    ? `<p style="margin:0 0 8px 0;font-size:13px;line-height:1.5;color:#6b7280;">${footerNote}</p>`
    : "";

  const recipientHtml = recipient
    ? `<p style="margin:20px 0 0 0;font-size:12px;line-height:1.5;color:#9ca3af;">Enviado a <strong style="color:#6b7280;font-weight:600;">${recipient}</strong>. Si no esperabas este correo, puedes ignorarlo.</p>`
    : "";

  const logoCell = logoUrl
    ? `<td><img src="${logoUrl}" alt="${escapeHtml(brandName)}" style="max-height:40px;max-width:120px;display:block"></td>`
    : `<td style="background-color:${brand};width:40px;height:40px;border-radius:10px;text-align:center;vertical-align:middle;color:#ffffff;font-size:20px;font-weight:700;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">${escapeHtml(brandName.charAt(0).toUpperCase() || "O")}</td>
                  <td style="padding-left:12px;font-size:18px;font-weight:600;color:#111827;">${escapeHtml(brandName)}</td>`;

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <!--[if mso]><style>a{text-decoration:none}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#111827;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f5f5f7;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;width:100%;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(15,23,42,0.06);">
          <tr>
            <td style="height:6px;background-color:${brand};background-image:linear-gradient(90deg,${brand},${DEFAULT_ACCENT});mso-line-height-rule:exactly;line-height:6px;font-size:0;">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding:32px 40px 0 40px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>${logoCell}</tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 40px 4px 40px;">
              <h1 style="margin:0 0 16px 0;font-size:24px;line-height:1.3;font-weight:700;color:#111827;">${escapeHtml(title)}</h1>
              ${bodyHtml}
            </td>
          </tr>
          ${extraHtmlRow}
          ${buttonHtml}
          <tr>
            <td style="padding:${button ? "0" : "8"}px 40px 32px 40px;border-top:1px solid #f1f1f4;margin-top:24px;">
              <div style="padding-top:20px;">
                ${noteHtml}
                ${recipientHtml}
                ${legalFooterHtml}
              </div>
            </td>
          </tr>
        </table>
        <p style="margin:20px 0 0 0;font-size:12px;color:#9ca3af;">Enviado con Ordy Chat</p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Oscurece un color hex (#RRGGBB) en ~15% para el borde del CTA. */
function darken(hex: string): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.max(0, ((n >> 16) & 0xff) - 30);
  const g = Math.max(0, ((n >> 8) & 0xff) - 30);
  const b = Math.max(0, (n & 0xff) - 30);
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

/** Versión texto plano — fallback para clientes que rechazan HTML. */
export function renderBrandedEmailText(opts: BrandedEmailOptions): string {
  const lines: string[] = [opts.title, ""];
  for (const p of opts.paragraphs) lines.push(stripTags(p), "");
  if (opts.button) {
    lines.push(opts.button.label + ":", opts.button.href, "");
  }
  if (opts.footerNote) lines.push(opts.footerNote);
  if (opts.recipient) lines.push("", `Enviado a ${opts.recipient}.`);
  lines.push("", "— Ordy Chat");
  return lines.join("\n");
}

/** Envía un email con branding Ordy Chat vía Resend. */
export async function sendBrandedEmail(input: SendBrandedEmailInput): Promise<void> {
  const apiKey = process.env.AUTH_RESEND_KEY;
  const from = process.env.AUTH_EMAIL_FROM ?? "noreply@ordysuite.com";
  if (!apiKey) throw new Error("AUTH_RESEND_KEY no configurada");

  const html = renderBrandedEmail(input);
  const text = input.text ?? renderBrandedEmailText(input);

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: input.to,
      subject: input.subject,
      html,
      text,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend ${res.status}: ${body}`);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "");
}

// ─── Validator failure email (Sprint 2 validador-core) ──────────────

export type ValidatorFailureEmailInput = {
  tenantEmail: string;
  tenantName: string;
  runId: string;
  /** Motivos concretos: ["seed=rest-03: idioma_ok=false", "seed=uni-06: judge_score=18/40"]. */
  reasons: string[];
  /** URL opcional al review (Sprint 3) — /admin/validator/<run_id>. */
  reviewUrl?: string;
};

/**
 * Envía email al owner del tenant cuando el validador detectó FAIL crítico
 * tras autopatch. El bot ya fue pausado (agent_configs.paused=true).
 * Reusa el helper sendBrandedEmail + plantilla Ordy Chat existente.
 */
export async function sendValidatorFailureEmail(
  input: ValidatorFailureEmailInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { tenantEmail, tenantName, runId, reasons, reviewUrl } = input;
  try {
    const listItems = reasons
      .slice(0, 10)
      .map((r) => `<li style="margin:0 0 6px 0;color:#4b5563;">${escapeHtml(r)}</li>`)
      .join("");
    const extraHtml = `
      <tr>
        <td style="padding:0 40px 16px 40px;">
          <p style="margin:0 0 8px 0;font-size:14px;font-weight:600;color:#111827;">
            Fallos detectados
          </p>
          <ul style="margin:0;padding-left:20px;font-size:14px;line-height:1.6;">
            ${listItems}
          </ul>
        </td>
      </tr>`;

    await sendBrandedEmail({
      to: tenantEmail,
      subject: `Tu agente de WhatsApp fue pausado — revisa los fallos (run ${runId.slice(0, 8)})`,
      title: "Tu agente fue pausado automáticamente",
      paragraphs: [
        `Hola${tenantName ? ` <strong>${escapeHtml(tenantName)}</strong>` : ""},`,
        "El validador automático detectó fallos críticos en las respuestas de tu agente y lo hemos <strong>pausado</strong> temporalmente para proteger a tus clientes.",
        "Intentamos corregir el system prompt automáticamente, pero los fallos se mantuvieron. Revisa los motivos abajo y ajusta tu configuración desde el dashboard.",
      ],
      extraHtml,
      button: reviewUrl
        ? { label: "Revisar en el dashboard", href: reviewUrl }
        : { label: "Ir al dashboard", href: (process.env.NEXT_PUBLIC_APP_URL ?? "https://ordychat.ordysuite.com") + "/dashboard" },
      footerNote: "Puedes reactivar tu agente cuando hayas corregido los fallos.",
      recipient: tenantEmail,
    });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
