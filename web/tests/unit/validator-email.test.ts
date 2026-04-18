// web/tests/unit/validator-email.test.ts — Test del helper sendValidatorFailureEmail.
//
// Mockeamos fetch para no enviar a Resend real. Verificamos shape del payload.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendValidatorFailureEmail } from "@/lib/email";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  // Stub env vars requeridas por sendBrandedEmail.
  vi.stubEnv("AUTH_RESEND_KEY", "re_stub_key_123");
  vi.stubEnv("AUTH_EMAIL_FROM", "test@ordychat.ordysuite.com");
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ id: "email_abc" }), { status: 200 })) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("sendValidatorFailureEmail", () => {
  it("llama Resend API con el email correcto y devuelve ok:true", async () => {
    const r = await sendValidatorFailureEmail({
      tenantEmail: "owner@restaurante.com",
      tenantName: "La Taberna",
      runId: "00000000-0000-0000-0000-000000000001",
      reasons: ["seed=rest-03: idioma_ok=false", "seed=uni-06: judge_score=12/40"],
    });

    expect(r.ok).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledOnce();

    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    expect((init as RequestInit).method).toBe("POST");

    const body = JSON.parse((init as { body: string }).body);
    expect(body.to).toBe("owner@restaurante.com");
    expect(body.subject).toContain("pausado");
    expect(body.html).toContain("La Taberna");
    expect(body.html).toContain("seed=rest-03");
    expect(body.html).toContain("seed=uni-06");
  });

  it("incluye reviewUrl como CTA si se pasa", async () => {
    await sendValidatorFailureEmail({
      tenantEmail: "a@b.com",
      tenantName: "X",
      runId: "00000000-0000-0000-0000-000000000002",
      reasons: ["x"],
      reviewUrl: "https://ordychat.ordysuite.com/admin/validator/abc",
    });
    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = JSON.parse((init as { body: string }).body);
    expect(body.html).toContain("/admin/validator/abc");
  });

  it("devuelve ok:false si Resend responde error", async () => {
    globalThis.fetch = vi.fn(async () => new Response("rate limit", { status: 429 })) as typeof fetch;
    const r = await sendValidatorFailureEmail({
      tenantEmail: "a@b.com",
      tenantName: "X",
      runId: "00000000-0000-0000-0000-000000000003",
      reasons: ["x"],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("429");
    }
  });

  it("trunca reasons a 10 items en el email", async () => {
    const manyReasons = Array.from({ length: 20 }, (_, i) => `reason-${i}`);
    await sendValidatorFailureEmail({
      tenantEmail: "a@b.com",
      tenantName: "X",
      runId: "00000000-0000-0000-0000-000000000004",
      reasons: manyReasons,
    });
    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = JSON.parse((init as { body: string }).body);
    // Los primeros 10 aparecen, el 11+ no.
    expect(body.html).toContain("reason-0");
    expect(body.html).toContain("reason-9");
    expect(body.html).not.toContain("reason-15");
  });

  it("escapa HTML en tenantName (XSS-safe)", async () => {
    await sendValidatorFailureEmail({
      tenantEmail: "a@b.com",
      tenantName: "<script>alert(1)</script>",
      runId: "00000000-0000-0000-0000-000000000005",
      reasons: ["<img src=x>"],
    });
    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = JSON.parse((init as { body: string }).body);
    expect(body.html).not.toContain("<script>alert(1)");
    expect(body.html).not.toContain("<img src=x>");
    expect(body.html).toContain("&lt;script&gt;");
  });
});
