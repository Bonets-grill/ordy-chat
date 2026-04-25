// web/promptfoo/brain/providers/runtime-brain.js
//
// Custom Promptfoo provider para el brain de Ordy Chat.
//
// Hace POST a `${RUNTIME_URL}/internal/playground/generate` con sandbox=true
// (is_test=true en DB → no envía WA real, no factura). Soporta multi-turn:
// si el case define un array de "messages" se envían tal cual; si solo
// define "user" se construye [{ role: 'user', content: <user> }].
//
// El output expone:
//   - text: respuesta literal del bot
//   - tokens_in / tokens_out
//   - cards: array de cards si el bot llamó mostrar_producto
//
// Para detectar tool-use real (crear_pedido, etc) la única forma fiable es
// consultar la DB tras el turno. El provider opcionalmente acepta un
// `pollDb` block en config.options con SQL — devuelve `db.<key>` con resultados.
// Esto permite assertions como javascript: output.db.orderCreated > 0.

const DEFAULT_TIMEOUT_MS = 60_000;

class RuntimeBrainProvider {
  constructor(options = {}) {
    this.providerId = options.id ?? 'runtime-brain';
    this.config = options.config ?? {};
  }

  id() {
    return this.providerId;
  }

  async callApi(prompt, context) {
    const cfg = { ...this.config, ...(context?.vars ?? {}) };
    const runtimeUrl = process.env.RUNTIME_URL || cfg.runtime_url;
    const secret = process.env.RUNTIME_INTERNAL_SECRET || cfg.runtime_internal_secret;
    if (!runtimeUrl || !secret) {
      return { error: 'RUNTIME_URL y RUNTIME_INTERNAL_SECRET requeridos en env' };
    }

    const tenantSlug = cfg.tenant_slug || 'bonets-grill-icod';
    const lang = cfg.client_lang || 'es';
    const channel = cfg.channel; // "menu_web" para mesas, undefined para WA
    const tableNumber = cfg.table_number;

    // Resolver mensajes: el `prompt` que pasa promptfoo puede ser:
    //   1. string plano del último mensaje del usuario → wrap a [user]
    //   2. JSON-string de messages array → parse y usa tal cual
    let messages;
    if (typeof prompt === 'string') {
      const trimmed = prompt.trim();
      if (trimmed.startsWith('[')) {
        try {
          messages = JSON.parse(trimmed);
        } catch {
          messages = [{ role: 'user', content: prompt }];
        }
      } else {
        messages = [{ role: 'user', content: prompt }];
      }
    } else if (Array.isArray(prompt)) {
      messages = prompt;
    } else {
      return { error: `prompt no soportado: ${typeof prompt}` };
    }

    const body = {
      tenant_slug: tenantSlug,
      client_lang: lang,
      messages,
      ...(channel ? { channel } : {}),
      ...(tableNumber ? { table_number: String(tableNumber) } : {}),
    };

    const startedAt = Date.now();
    let res;
    try {
      res = await fetch(`${runtimeUrl.replace(/\/$/, '')}/internal/playground/generate`, {
        method: 'POST',
        headers: {
          'x-internal-secret': secret,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(cfg.timeout_ms ?? DEFAULT_TIMEOUT_MS),
      });
    } catch (e) {
      return {
        error: `fetch falló: ${e instanceof Error ? e.message : String(e)}`,
        latency_ms: Date.now() - startedAt,
      };
    }

    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { response: text };
    }

    if (!res.ok) {
      return {
        error: `HTTP ${res.status}: ${text.slice(0, 300)}`,
        latency_ms: Date.now() - startedAt,
      };
    }

    // Poll DB opcional para detectar tool-use efectivo (orders, reservas, etc).
    // El provider acepta pollDb: { sql: "SELECT ... LIMIT 1", waitMs: 2000 }
    // o pollDb: [{ key, sql, waitMs }] para varias queries.
    let db;
    if (cfg.pollDb) {
      db = await pollDb(cfg.pollDb);
    }

    return {
      output: {
        text: json.response ?? '',
        tokens_in: json.tokens_in ?? 0,
        tokens_out: json.tokens_out ?? 0,
        cards: json.cards ?? [],
        db: db ?? null,
      },
      latency_ms: Date.now() - startedAt,
      tokenUsage: {
        prompt: json.tokens_in ?? 0,
        completion: json.tokens_out ?? 0,
        total: (json.tokens_in ?? 0) + (json.tokens_out ?? 0),
      },
    };
  }
}

async function pollDb(spec) {
  const { neon } = await import('@neondatabase/serverless');
  const url = process.env.DATABASE_URL;
  if (!url) return { error: 'DATABASE_URL no configurada' };
  const sql = neon(url);

  const queries = Array.isArray(spec) ? spec : [{ key: 'rows', ...spec }];
  const result = {};
  for (const q of queries) {
    if (q.waitMs) await new Promise((r) => setTimeout(r, q.waitMs));
    try {
      // neon-http exposes tagged template; usamos fallback function form.
      const rows = await sql(q.sql);
      result[q.key] = rows;
    } catch (e) {
      result[q.key] = { error: e instanceof Error ? e.message : String(e) };
    }
  }
  return result;
}

module.exports = RuntimeBrainProvider;
