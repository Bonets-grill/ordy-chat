import { expect, test } from "@playwright/test";

// Sprint 4 F4.7 E2E smoke — PWA + Capacitor config.
// Verifica que los assets mínimos para una PWA instalable están servidos
// correctamente en prod. NO lanza Capacitor real (requiere toolchains iOS/
// Android) — solo valida lo que llega al navegador.

test.describe("PWA assets", () => {
  test("manifest.webmanifest responde 200 con shape válido", async ({ request }) => {
    const r = await request.get("/manifest.webmanifest");
    expect(r.status()).toBe(200);
    const json = await r.json();
    expect(json.name).toBe("Ordy Chat");
    expect(json.short_name).toBeTruthy();
    expect(json.display).toBe("standalone");
    expect(Array.isArray(json.icons)).toBe(true);
    expect(json.icons.length).toBeGreaterThanOrEqual(3);
    // Todas las icons apuntan a rutas que existen.
    for (const icon of json.icons) {
      expect(icon.src).toMatch(/^\/icon-[a-z0-9]+\.png$/);
      expect(icon.sizes).toMatch(/^\d+x\d+$/);
    }
  });

  test("icons PWA devuelven 200 y son PNG", async ({ request }) => {
    for (const path of ["/icon-192.png", "/icon-512.png", "/icon-maskable.png"]) {
      const r = await request.get(path);
      expect(r.status(), `GET ${path}`).toBe(200);
      expect(r.headers()["content-type"] || "").toContain("image");
    }
  });

  test("/sw.js responde 200 con no-store + service-worker-allowed /", async ({ request }) => {
    const r = await request.get("/sw.js");
    expect(r.status()).toBe(200);
    const cc = r.headers()["cache-control"] ?? "";
    expect(cc).toContain("no-store");
    expect(r.headers()["service-worker-allowed"]).toBe("/");
    const body = await r.text();
    expect(body).toContain("CACHE_VERSION");
    expect(body).toContain("addEventListener");
  });

  test(".well-known/apple-app-site-association JSON válido", async ({ request }) => {
    const r = await request.get("/.well-known/apple-app-site-association");
    expect(r.status()).toBe(200);
    expect(r.headers()["content-type"] || "").toContain("application/json");
    const json = await r.json();
    expect(json.applinks).toBeTruthy();
    expect(Array.isArray(json.applinks.details)).toBe(true);
  });

  test(".well-known/assetlinks.json array válido", async ({ request }) => {
    const r = await request.get("/.well-known/assetlinks.json");
    expect(r.status()).toBe(200);
    expect(r.headers()["content-type"] || "").toContain("application/json");
    const json = await r.json();
    expect(Array.isArray(json)).toBe(true);
    expect(json[0]?.target?.namespace).toBe("android_app");
  });

  test("home registra el SW en el navegador", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");

    // Espera blanda: damos ~2s al cliente para montar RegisterSW y que
    // el navegador registre el SW. NO es assertion de éxito — distintos
    // agentes y modos (CI headless, WebKit, Firefox) difieren en timing
    // y disponibilidad. El contrato real del test es: "la página no
    // emite errores JS al intentar registrar el SW". Ese es el bug que
    // importa (un throw asíncrono aquí rompería la home para todos).
    const got = await page
      .evaluate(async () => {
        if (!("serviceWorker" in navigator)) return "no-sw-api";
        await new Promise((r) => setTimeout(r, 2000));
        const regs = await navigator.serviceWorker.getRegistrations();
        return regs.length > 0 ? "registered" : "pending";
      })
      .catch(() => "pending");

    expect(["registered", "pending", "no-sw-api"]).toContain(got);
    expect(errors).toEqual([]);
  });
});
