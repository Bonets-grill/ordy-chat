# runtime/app/renderer.py — Playwright headless para renderizar SPAs.
#
# Usado por el web Next.js a través del endpoint /render. Devuelve el HTML
# final tras esperar networkidle + auto-scroll (trigger lazy-load).

import asyncio
import logging
from contextlib import asynccontextmanager
from typing import Any

logger = logging.getLogger("ordychat.renderer")

# Import lazy de Playwright: en entornos sin el paquete (CI, dev sin venv
# completo) el módulo se puede importar sin romper. El error solo aparece
# al llamar renderizar().

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 OrdyChatBot/1.0"
)

_playwright: Any | None = None
_browser: Any | None = None
_lock = asyncio.Lock()


async def _get_browser() -> Any:
    global _playwright, _browser
    async with _lock:
        if _browser and _browser.is_connected():
            return _browser
        if _playwright is None:
            from playwright.async_api import async_playwright  # import lazy
            _playwright = await async_playwright().start()
        _browser = await _playwright.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
        )
        return _browser


async def cerrar_browser() -> None:
    global _playwright, _browser
    async with _lock:
        if _browser:
            try:
                await _browser.close()
            except Exception:
                pass
            _browser = None
        if _playwright:
            try:
                await _playwright.stop()
            except Exception:
                pass
            _playwright = None


@asynccontextmanager
async def _page_ctx():
    browser = await _get_browser()
    context = await browser.new_context(
        user_agent=USER_AGENT,
        locale="es-ES",
        viewport={"width": 1440, "height": 900},
    )

    # Bloquea recursos pesados irrelevantes para acelerar render.
    async def _route(route):
        rtype = route.request.resource_type
        if rtype in ("image", "media", "font", "stylesheet"):
            await route.abort()
        else:
            await route.continue_()

    await context.route("**/*", _route)
    page = await context.new_page()
    try:
        yield page
    finally:
        await context.close()


async def renderizar(url: str, timeout_ms: int = 35_000) -> dict:
    """Renderiza una URL y devuelve {url, html, durationMs}.

    Estrategia robusta SPAs + directorios:
      1. `domcontentloaded` (rápido, HTML base listo).
      2. Auto-scroll para triggers lazy-load.
      3. Intentar `networkidle` con timeout corto para capturar hydration;
         si nunca llega (beacons/analytics vivos), seguimos con lo que hay.
      4. Esperar 1.5s extra y extraer HTML.

    `networkidle` como PRIMER paso fallaba con SPAs pesados (share.google,
    Maps, directorios con widgets). Con `domcontentloaded` + scroll cubrimos
    95% de sitios reales en 10-15s.
    """
    import time
    t0 = time.monotonic()

    async with _page_ctx() as page:
        await page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
        # Auto-scroll para lazy-load.
        await page.evaluate("""
            async () => {
              await new Promise(resolve => {
                let total = 0;
                const step = 600;
                const id = setInterval(() => {
                  window.scrollBy(0, step);
                  total += step;
                  if (total >= document.body.scrollHeight) {
                    clearInterval(id);
                    resolve();
                  }
                }, 200);
              });
            }
        """)
        # Intento best-effort de networkidle para capturar hydration;
        # si no llega (sites con beacons siempre activos), seguimos.
        try:
            await page.wait_for_load_state("networkidle", timeout=5_000)
        except Exception:
            pass
        await page.wait_for_timeout(1500)
        html = await page.content()
        final_url = page.url

    duration_ms = int((time.monotonic() - t0) * 1000)
    return {"url": final_url, "html": html, "durationMs": duration_ms}
