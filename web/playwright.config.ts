import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    // Usamos build + start en vez de dev para que Playwright teste el
    // bundle real de producción. Esto evita el hydration glitch donde
    // Suspense + React dev-mode doble-render provocan que clicks de
    // Playwright lleguen al DOM antes de que los handlers estén vivos
    // (observado en 02-auth: toggle "Prefiero enlace mágico" no
    // disparaba setState aunque el DOM lo listara).
    //
    // Coste: build tarda ~30-90s la primera vez. reuseExistingServer
    // sigue activo, así que en dev local puedes `pnpm build && pnpm start`
    // en otra ventana y Playwright reusa la instancia.
    command: "pnpm build && pnpm start -p 3000",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 240_000,
  },
});
