# Capacitor iOS/Android + PWA real + Native Polish — Design Spec

**Fecha:** 2026-04-18
**Sprints:** 4 (Capacitor + PWA) + 5 (Native polish)
**Scope:** convertir Ordy Chat (Next.js 16 App Router + Auth.js v5 + Drizzle/Neon) en una PWA instalable + bundle Capacitor iOS + Android con login funcional y look nativo.

---

## §1 Motivación

Hoy `ordychat.ordysuite.com` es **solo web**. Usuarios que instalan el shortcut en iPhone no ven splash nativo, no hay offline mínimo, el SW `/sw.js` es kill-switch (no cachea nada), y no hay bundle `.ipa/.apk` que Mario pueda enviar a App Store / Play Store.

**Meta:**
- Sprint 4: PWA funcional + bundle Capacitor instalable en iOS/Android (dev build suficiente — no firma de App Store aún).
- Sprint 5: cada pantalla se siente nativa (safe-area, haptics, swipe-back, animaciones).

**Fuera de scope (posponer a Sprint 6):**
- Push notifications (APNS + FCM — requiere certificados + backend worker).
- Firma + subida a App Store / Play Store.
- In-app purchases.

---

## §2 Stack confirmado

| Capa | Tecnología | Versión |
|---|---|---|
| Framework web | Next.js | 16.2.4 |
| UI | React 19.2.5 + Tailwind v3 + shadcn |
| Mobile wrapper | **Capacitor** | 8.x (core + plugins) |
| Plugins Capacitor MVP | `@capacitor/ios`, `@capacitor/android`, `@capacitor/haptics`, `@capacitor/app`, `@capacitor/status-bar`, `@capacitor/splash-screen`, `@capacitor/keyboard` | ^8 |
| Auth bundle-friendly | Auth.js v5 JWT + `authorization: Bearer` header en Capacitor | ya instalado |
| PWA SW | Nativo (sin workbox — control total) | N/A |
| Build mobile | Script Node `scripts/build-mobile.mjs` + `next build && next export` | N/A |
| Deep links | Universal Links (iOS) + App Links (Android) — patrón `https://ordychat.ordysuite.com/*` | config nativa |

**No-goals:** NO introducir Ionic (puro Tailwind sirve). NO react-native. NO expo. NO workbox (el SW manual es 30 líneas).

---

## §3 Arquitectura

```
┌────────── Next.js web (SSR on Vercel) ─────────┐
│  /                    público                  │
│  /signin              magic-link + Google      │
│  /dashboard, /admin   auth cookie (navegador)  │
│                                                │
│  /api/auth/*          Auth.js v5 handlers      │
│                       + ACCEPT Bearer token    │
└──────────────┬─────────────────────────────────┘
               │
┌──────────────▼──────────── Capacitor bundle ───┐
│  WebView → carga https://ordychat.ordysuite.com│
│  (no export estático — live URL).              │
│                                                │
│  CapacitorInit.tsx:                            │
│    - detecta isNativePlatform()                │
│    - StatusBar.setStyle                        │
│    - SplashScreen.hide tras hydration          │
│    - inyecta safe-area CSS vars                │
│    - configura useHaptics()                    │
│                                                │
│  Auth bridge:                                  │
│    - Bearer token guardado en                  │
│      Capacitor Preferences                     │
│    - auth.ts server acepta                     │
│      Authorization: Bearer xxx                 │
└────────────────────────────────────────────────┘

┌────────── PWA (Safari iOS / Chrome Android) ───┐
│  manifest.webmanifest: name, icons, theme,     │
│    display:standalone, background_color        │
│  /sw.js: cache v1 con estrategias:             │
│    - shell (/, /signin, /dashboard): cache-    │
│      first + SWR                               │
│    - API /api/*: network-first (no cache)      │
│    - static assets /_next/: cache-first        │
│    - SSE/streaming: bypass                     │
│  RegisterSW.tsx montado en root layout.        │
└────────────────────────────────────────────────┘
```

### Decisiones clave

1. **Capacitor usa live URL**, no export estático. Simplifica auth (cookies funcionan en WebView Android; en iOS necesitamos Bearer token fallback), simplifica deploys (un único pipeline: Vercel push = app actualizada sin rebuild del `.ipa`).
2. **SW v1** sustituye al kill-switch actual. No borra — solo actualiza.
3. **Bearer token path** se habilita SOLO cuando `X-Requested-With: OrdyChat-Capacitor` llega en el request. Web sigue usando cookies.
4. **Haptics + StatusBar** se no-opean en web (no crashes en Safari).

---

## §4 Schema DB

**No cambia.** Todo en Auth.js v5 existente. Añado 1 columna opcional:

```sql
-- shared/migrations/012_capacitor_devices.sql (opcional, solo si añadimos push)
-- Sprint 4 NO la aplica. Placeholder para Sprint 6.
```

Sprint 4 **no toca DB**.

---

## §5 Plan de fases (Sprint 4 = 7 fases)

### Fase 4.1 — PWA real (sw.js cache v1 + manifest)
- Sustituir `web/public/sw.js` kill-switch por SW con cache v1.
- Crear `web/public/manifest.webmanifest` (o usar `app/manifest.ts` Next 15+ convención).
- Generar icons: 192x192, 512x512, maskable-512 en `web/public/icons/` (brand #7c3aed, letra "O" blanca).
- `app/layout.tsx`: `<link rel="manifest">` + meta theme-color + apple-touch-icon.
- Nuevo `web/components/register-sw.tsx` client component montado en root layout.

### Fase 4.2 — Capacitor base
- `pnpm add @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android`.
- `capacitor.config.ts` en raíz del proyecto (arriba de `web/`).
- appId `com.ordysuite.ordychat`. webDir apunta a live URL (`server.url`).
- `npx cap add ios` + `npx cap add android` (crea `ios/` y `android/` dirs).
- `CapacitorBridge.tsx` ya existe (verificado en grep) — extenderlo con detect + StatusBar.

### Fase 4.3 — Auth bundle-friendly
- `web/lib/auth.ts` callback: si request trae `Authorization: Bearer xxx` → validar JWT manualmente y devolver session.
- `web/lib/capacitor-auth.ts`: cliente helper para guardar token tras login y añadirlo a fetch.
- Modificar signin page: detectar `window.Capacitor?.isNativePlatform()` y, tras sign-in exitoso, guardar token en Preferences.

### Fase 4.4 — Build pipeline mobile
- `scripts/build-mobile.mjs`: ejecuta `cap sync` + abre el IDE correspondiente.
- `package.json` scripts: `build:ios`, `build:android`, `open:ios`, `open:android`.

### Fase 4.5 — Icons + splash
- Generar via [pwa-asset-generator] o manual 3 sizes para PWA + splash iOS (2048x2732 + tamaños Android).
- `resources/icon.png` + `resources/splash.png` → `npx @capacitor/assets generate`.

### Fase 4.6 — Deep links (universal + app)
- iOS: `apple-app-site-association` en `web/public/.well-known/`.
- Android: `assetlinks.json` en `web/public/.well-known/`.
- `capacitor.config.ts`: `allowNavigation: ['ordychat.ordysuite.com']`.
- App.addListener('appUrlOpen') → router.push al path.

### Fase 4.7 — Smoke tests mobile
- `web/e2e/09-pwa.spec.ts`: verifica manifest + sw + icons accesibles.
- Script manual `scripts/test-capacitor.sh`: sincroniza + hace `cap run ios --target <simulator>`.

---

## §6 Sprint 5 — Native polish (5 fases)

### Fase 5.1 — Safe-area insets
- `app/globals.css`: CSS vars `--safe-t`, `--safe-b`, `--safe-l`, `--safe-r` desde `env(safe-area-inset-*)`.
- BottomNav: `padding-bottom: var(--safe-b)`.
- Header: `padding-top: var(--safe-t)`.
- `viewport-fit=cover` en root meta.

### Fase 5.2 — Haptics hook
- `web/lib/hooks/use-haptics.ts`: wrapper de `@capacitor/haptics` con no-op en web.
- Integrar en: buttons primarios (click = ImpactStyle.Medium), swipe success (Notification.Success), errores (Notification.Error).

### Fase 5.3 — Swipe-back + gesture
- Capacitor iOS trae swipe-back nativo gratis (config webview).
- Android: `App.addListener('backButton')` → router.back().

### Fase 5.4 — Pull-to-refresh
- `web/components/pull-to-refresh.tsx`: componente propio (no plugin). Touch events + router.refresh().
- Integrar en `/dashboard`, `/conversations`, `/admin`.

### Fase 5.5 — Transiciones + skeletons
- View transitions API (soportada en Chrome Android, polyfill en iOS).
- `loading.tsx` en rutas principales con skeleton animado.

---

## §7 Riesgos & mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Next.js App Router SSR + WebView cookies | HIGH — auth roto en iOS Capacitor | Bearer token fallback en Auth.js callbacks |
| SW caché agresiva tras deploy | HIGH — usuarios atrapados versión vieja | `skipWaiting` + versión en query param + mensaje UX "nueva versión, refresca" |
| iOS certificates no firmados | MEDIUM — `.ipa` solo para dev | Sprint 4 genera build dev, App Store firma → Sprint 6 |
| Auto-updating PWA sin borrar caché | MEDIUM | Cache name con hash `ordy-v{BUILD_ID}` → nuevo deploy = nuevo cache = barrido |
| Android emulator no instalado local | LOW — bloquea Fase 4.7 | Usar Expo Snack o device físico; no bloquear Sprint 5 por esto |

---

## §8 Métricas de éxito

Sprint 4:
- `curl https://ordychat.ordysuite.com/manifest.webmanifest` → 200 JSON válido.
- `curl https://ordychat.ordysuite.com/sw.js` → 200 con `Cache-Control: no-store` y código cache v1.
- `npx cap sync ios` y `npx cap sync android` terminan sin errores.
- Chrome DevTools Lighthouse PWA score ≥ 85.
- App carga live URL en iOS Simulator sin crash de auth.

Sprint 5:
- Safe-area visible en iPhone 15 Pro notch.
- Haptic se dispara en click botón brand.
- Swipe-back funciona en iOS.
- Pull-to-refresh actualiza conversations list.

---

## §9 Compromiso

Blueprint y build order se generan con `the-architect`. Audit con `audit-architect` (5 auditores) antes de ejecutar. Cada fase commit separado. Deploy continuo: cada push a main = Vercel rebuild + Mario prueba en Safari iOS inmediato. Capacitor rebuild solo cuando cambie algo nativo (casi nunca — solo config/plugins).
