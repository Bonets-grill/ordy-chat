// web/lib/evolution.ts — Cliente de Evolution API (self-hosted WhatsApp).
//
// Evolution es open-source y multi-instancia: cada tenant tiene su propia
// instancia aislada en el mismo servidor. La URL + apikey son globales de
// plataforma (env vars); el `instanceName` es único por tenant (ordy-{slug}).

const BASE_URL = process.env.EVOLUTION_API_URL || "";
const API_KEY = process.env.EVOLUTION_API_KEY || "";

export function evolutionConfigured(): boolean {
  return Boolean(BASE_URL && API_KEY);
}

export function evolutionInstanceName(slug: string): string {
  // Prefijo para no colisionar con otras apps que compartan el servidor.
  return `ordy-${slug}`;
}

async function evoFetch(path: string, init: RequestInit = {}) {
  if (!evolutionConfigured()) {
    throw new Error("Evolution no configurado (faltan EVOLUTION_API_URL / EVOLUTION_API_KEY)");
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      apikey: API_KEY,
      ...(init.headers || {}),
    },
    // Evolution a veces tarda en /instance/connect; le damos 30s.
    signal: init.signal ?? AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    throw new Error(`Evolution ${path} ${res.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  }
  return data;
}

// ── Instance lifecycle ────────────────────────────────────────
/**
 * `webhookSecret`, si se pasa, se envía como header `X-Ordy-Signature` en vez
 * de en el query string, lo que evita que aparezca en access logs. El runtime
 * valida header O query param (backward compat con instancias antiguas).
 */
export async function createInstance(
  instanceName: string,
  webhookUrl: string,
  opts: { events?: string[]; webhookSecret?: string } = {},
) {
  const events = opts.events ?? ["CONNECTION_UPDATE", "MESSAGES_UPSERT", "QRCODE_UPDATED"];
  const headers = opts.webhookSecret ? { "X-Ordy-Signature": opts.webhookSecret } : undefined;
  try {
    return await evoFetch("/instance/create", {
      method: "POST",
      body: JSON.stringify({
        instanceName,
        integration: "WHATSAPP-BAILEYS",
        qrcode: true,
        webhook: { url: webhookUrl, byEvents: false, events, ...(headers ? { headers } : {}) },
      }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/already in use|already exists/i.test(msg)) throw err;
    await setWebhook(instanceName, webhookUrl, { events, webhookSecret: opts.webhookSecret });
    return { alreadyExists: true };
  }
}

export async function setWebhook(
  instanceName: string,
  webhookUrl: string,
  opts: { events?: string[]; webhookSecret?: string } = {},
) {
  const events = opts.events ?? ["CONNECTION_UPDATE", "MESSAGES_UPSERT", "QRCODE_UPDATED"];
  const headers = opts.webhookSecret ? { "X-Ordy-Signature": opts.webhookSecret } : undefined;
  // IMPORTANTE: byEvents=false → Evolution manda webhooks al mismo path fijo.
  // Con byEvents=true añadiría sufijos como /messages-upsert que el runtime no tiene.
  return evoFetch(`/webhook/set/${instanceName}`, {
    method: "POST",
    body: JSON.stringify({
      webhook: {
        enabled: true,
        url: webhookUrl,
        byEvents: false,
        base64: false,
        events,
        ...(headers ? { headers } : {}),
      },
    }),
  });
}

export async function getQR(instanceName: string) {
  return evoFetch(`/instance/connect/${instanceName}`);
}

export async function getPairingCode(instanceName: string, phoneNumber: string) {
  const num = phoneNumber.replace(/\D/g, "");
  if (num.length < 8) throw new Error("phoneNumber inválido");
  return evoFetch(`/instance/connect/${instanceName}?number=${num}`);
}

export async function getStatus(instanceName: string) {
  return evoFetch(`/instance/connectionState/${instanceName}`);
}

export async function logoutInstance(instanceName: string) {
  return evoFetch(`/instance/logout/${instanceName}`, { method: "DELETE" });
}

export async function deleteInstance(instanceName: string) {
  return evoFetch(`/instance/delete/${instanceName}`, { method: "DELETE" });
}
