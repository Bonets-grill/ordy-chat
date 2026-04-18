# Mobile Setup — Capacitor iOS + Android

Sprint 4 deja el código y la config Capacitor listos. Para generar los bundles nativos (`.ipa` iOS y `.apk/.aab` Android) necesitas instalar las toolchains una sola vez en tu Mac.

## iOS

Requisitos:

1. **Xcode completo** (no solo Command Line Tools)
   - Mac App Store → Xcode → Install.
   - Tras instalar: `sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer`
   - Aceptar términos: `sudo xcodebuild -license accept`
2. **CocoaPods**
   ```bash
   brew install cocoapods
   pod --version   # debe ser ≥ 1.15
   ```

Ya instalados lo anterior, añade la plataforma:

```bash
cd web
npx cap add ios
```

Esto crea `web/ios/App/` con el proyecto Xcode. Abrirlo:

```bash
npm run build:mobile:ios   # sync + open Xcode
```

Desde Xcode:
- Selecciona un Simulator (p.ej. iPhone 15 Pro)
- Cmd+R para run
- El WebView carga `https://ordychat.ordysuite.com` directamente

Para distribuir por TestFlight / App Store:
- Apple Developer Account (99 €/año)
- Certificate + Provisioning Profile en Xcode → Signing & Capabilities
- Archive → Distribute

## Android

Requisitos:

1. **Android Studio**
   - https://developer.android.com/studio → download → install.
   - Primera vez: descarga SDK + platform-tools automáticamente.
2. **Variables de entorno** (en `~/.zshrc`):
   ```bash
   export ANDROID_HOME="$HOME/Library/Android/sdk"
   export PATH="$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator"
   ```
3. Abrir nueva terminal y verificar:
   ```bash
   adb --version   # Android Debug Bridge >= 1.0.41
   ```

Añadir plataforma:

```bash
cd web
npx cap add android
```

Abrir Android Studio:

```bash
npm run build:mobile:android   # sync + open Android Studio
```

Para distribuir por Google Play:
- Cuenta Play Console (25 USD pago único)
- Generar signed AAB desde Android Studio → Build → Generate Signed Bundle
- Subir a Play Console → Internal testing primero

## Deep links (universal + app links)

Fase 4.6 del blueprint: añade `.well-known/apple-app-site-association` (iOS)
y `.well-known/assetlinks.json` (Android) servidos por Vercel para que URLs
tipo `https://ordychat.ordysuite.com/dashboard` se abran en la app cuando
esté instalada.

## Flujo de updates

Como el WebView usa live URL, **cada push a main = app actualizada al instante**
sin necesidad de rebuild del bundle. Solo se reconstruye el `.ipa`/`.apk`
cuando cambian:

- `capacitor.config.ts`
- Plugins Capacitor (añadir/quitar)
- Icons/splash nativos
- Permisos (Info.plist / AndroidManifest.xml)
