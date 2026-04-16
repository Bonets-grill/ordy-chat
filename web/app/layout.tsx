import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Ordy Chat — Tu agente de WhatsApp con IA en 5 minutos",
  description:
    "Plataforma SaaS multi-tenant para que cualquier negocio tenga su agente de WhatsApp con IA. €19.90/mes, 7 días gratis.",
  openGraph: {
    title: "Ordy Chat",
    description: "Tu agente de WhatsApp con IA en 5 minutos. €19.90/mes.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
