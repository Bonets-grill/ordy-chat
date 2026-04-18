import type { Metadata, Viewport } from "next";
import { CapacitorBridge } from "@/components/capacitor-bridge";
import { CookieConsent } from "@/components/cookie-consent";
import { RefTracker } from "@/components/ref-tracker";
import { RegisterSW } from "@/components/register-sw";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Ordy Chat — Tu agente de WhatsApp con IA en 5 minutos",
  description:
    "Plataforma SaaS multi-tenant para que cualquier negocio tenga su agente de WhatsApp con IA. €19.90/mes, 7 días gratis.",
  applicationName: "Ordy Chat",
  appleWebApp: {
    capable: true,
    title: "Ordy Chat",
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
  },
  openGraph: {
    title: "Ordy Chat",
    description: "Tu agente de WhatsApp con IA en 5 minutos. €19.90/mes.",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#ffffff" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen antialiased">
        <CapacitorBridge />
        <RegisterSW />
        <Providers>{children}</Providers>
        <CookieConsent />
        <RefTracker />
      </body>
    </html>
  );
}
