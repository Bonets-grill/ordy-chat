// web/capacitor.config.ts — config del bundle iOS/Android.
// Sprint 4 F4.2.
//
// Estrategia: el WebView apunta a la live URL de producción. No usamos
// export estático. Esto simplifica auth (cookies funcionan en WebView Android;
// en iOS usamos Bearer token fallback implementado en F4.3).
//
// Deep links: allowNavigation restringido a nuestros dominios — bloquea
// redirects inesperados.

import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.ordysuite.ordychat",
  appName: "Ordy Chat",
  webDir: ".next",

  server: {
    // WebView carga la web en producción directamente.
    // En dev, sobreescribir con CAP_SERVER_URL=http://192.168.X.X:3000
    url: process.env.CAP_SERVER_URL ?? "https://ordychat.ordysuite.com",
    cleartext: Boolean(process.env.CAP_SERVER_URL),
    allowNavigation: [
      "ordychat.ordysuite.com",
      "*.ordysuite.com",
      // Google OAuth + magic link edge cases
      "accounts.google.com",
      "*.google.com",
    ],
  },

  ios: {
    contentInset: "always",
    // iOS: swipe-back nativo activado por defecto en webview Capacitor 8+.
    scheme: "OrdyChat",
  },

  android: {
    allowMixedContent: false,
    // Android status bar color matches brand.
    backgroundColor: "#7c3aed",
  },

  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      launchAutoHide: true,
      backgroundColor: "#7c3aed",
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
      androidScaleType: "CENTER_CROP",
    },
    StatusBar: {
      style: "LIGHT", // texto blanco sobre barra violeta
      backgroundColor: "#7c3aed",
    },
    Keyboard: {
      resize: "body",
      style: "DEFAULT",
    },
  },
};

export default config;
