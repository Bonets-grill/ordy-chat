import type { CapacitorConfig } from "@capacitor/cli";

const isDev = process.env.CAPACITOR_ENV === "development";
const prodUrl = process.env.CAPACITOR_URL ?? "https://ordychat.ordysuite.com";
const devUrl = process.env.CAPACITOR_DEV_URL ?? "http://localhost:3000";

const config: CapacitorConfig = {
  appId: "com.ordychat.app",
  appName: "Ordy Chat",
  webDir: "www",
  backgroundColor: "#ffffff",
  server: {
    // En dev: apunta al Next.js local (permite cleartext http).
    // En prod: apunta al deployment público (https obligatorio).
    url: isDev ? devUrl : prodUrl,
    cleartext: isDev,
    allowNavigation: [
      "ordychat.ordysuite.com",
      "*.ordysuite.com",
      "app.ordychat.com",
      "ordychat.com",
      "*.vercel.app",
      "*.whapi.cloud",
      "graph.facebook.com",
      "api.twilio.com",
    ],
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      launchAutoHide: true,
      backgroundColor: "#ffffff",
      androidScaleType: "CENTER_CROP",
      splashFullScreen: false,
      splashImmersive: false,
      showSpinner: false,
    },
    StatusBar: {
      style: "DEFAULT",
      backgroundColor: "#ffffff",
      overlaysWebView: false,
    },
    Keyboard: {
      resize: "native",
      resizeOnFullScreen: true,
    },
  },
  ios: {
    scheme: "OrdyChat",
    contentInset: "automatic",
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
