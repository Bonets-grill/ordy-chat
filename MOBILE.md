# Ordy Chat Mobile — iOS & Android con Capacitor

Apps móviles nativas que envuelven la web de Ordy Chat deployada. El WebView muestra la web con chrome nativo: status bar, splash screen, safe areas, back button Android, haptics.

## Estructura

```
mobile/
├── capacitor.config.ts    # Config: server.url, plugins, icons
├── package.json           # Deps Capacitor + plugins
├── www/                   # Stub (el webview apunta a server.url)
├── ios/                   # Proyecto Xcode generado
└── android/               # Proyecto Android Studio generado
```

## Arquitectura

El binario nativo es un shell ligero. Apunta a:
- **Dev:** `http://localhost:3000` (cuando `CAPACITOR_ENV=development`)
- **Prod:** `https://app.ordychat.com` (o el que pongas en `CAPACITOR_URL`)

La web detecta automáticamente que está en Capacitor (via `components/capacitor-bridge.tsx`) y activa:
- Status bar con fondo blanco
- Splash screen con fade out
- Back button Android → `history.back()` / `exitApp()`
- Safe-area-inset en header/footer/navbar
- `user-select: none` en UI (pero yes en inputs/textareas)

## Primer build — iOS

Requisitos:
- macOS
- [Xcode](https://apps.apple.com/us/app/xcode/id497799835) del App Store (no solo CLI tools)
- `sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer`
- CocoaPods: `sudo gem install cocoapods` o `brew install cocoapods`

```bash
cd mobile
pnpm install
cd ios/App && pod install
cd ../..
pnpm cap:open:ios        # abre Xcode
```

En Xcode:
1. Selecciona tu **Team** (Signing & Capabilities)
2. Cambia el Bundle Identifier si `com.ordychat.app` está tomado
3. Run ▶ — lanza el simulador o el dispositivo conectado

Para producción: **Archive → Distribute → App Store Connect**.

## Primer build — Android

Requisitos:
- [Android Studio](https://developer.android.com/studio)
- JDK 17

```bash
cd mobile
pnpm install
pnpm cap:open:android    # abre Android Studio
```

En Android Studio:
1. Espera a que termine el Gradle sync (1–3 min la primera vez)
2. Run ▶ — emulador o dispositivo conectado

Para producción: **Build → Generate Signed Bundle/APK → AAB → firmar → subir a Play Console**.

## Iconos y splash

Para poner tus iconos, crea `mobile/resources/icon.png` (1024×1024) y `mobile/resources/splash.png` (2732×2732) y ejecuta:

```bash
pnpm dlx @capacitor/assets generate
```

Eso rellena `ios/App/App/Assets.xcassets` y `android/app/src/main/res/` con todas las densidades.

## Apuntar al deployment

Edita `mobile/capacitor.config.ts`:

```ts
server: {
  url: "https://app.ordychat.com",  // tu dominio real
  allowNavigation: ["app.ordychat.com", "ordychat.com"],
}
```

Luego `pnpm cap:sync` y re-lanza los builds.

## Workflow día a día

Cuando cambias el web:
1. `pnpm dev` en `web/` (mantén el Mac conectado al WiFi del dispositivo de pruebas)
2. En `mobile/capacitor.config.ts`, pon `server.url = "http://<IP_DE_TU_MAC>:3000"`
3. `pnpm cap:sync`
4. Corre la app en el simulador/dispositivo — recarga automáticamente a cada cambio del web

Cuando cambias plugins o deps Capacitor:
```bash
cd mobile
pnpm install
pnpm cap:sync
```

## Publicación a stores

- **App Store:** cuenta Apple Developer ($99/año). Archive desde Xcode → App Store Connect → TestFlight → submit for review.
- **Play Store:** cuenta Google Play Console ($25 una vez). Sube el AAB firmado → test track → production.

Ambos stores piden:
- Icono 1024×1024
- Screenshots (iPhone 6.7", iPad 12.9", Android 1080×1920 mínimo)
- Política de privacidad pública (ya tenemos `/privacy`)
- Términos (ya tenemos `/terms`)
- Descripción + keywords
