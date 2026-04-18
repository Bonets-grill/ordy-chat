// web/lib/auth.ts — Auth.js v5 con Drizzle + magic link Resend.

import { DrizzleAdapter } from "@auth/drizzle-adapter";
import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import Resend from "next-auth/providers/resend";
import { db } from "@/lib/db";
import { accounts, sessions, users, verificationTokens } from "@/lib/db/schema";

const ALLOW_DEV_LOGIN = process.env.ALLOW_DEV_LOGIN === "1";

function renderMagicLinkEmail(url: string, email: string): string {
  // Bulletproof email — tables en lugar de divs, color sólido en lugar de gradient
  // (Gmail / Outlook sanitizan gradientes e `a[display:inline-block]` agresivamente).
  const brand = "#7c3aed";      // violeta principal
  const brandDark = "#6d28d9";  // borde / hover
  const accent = "#ec4899";     // rosa para la banda decorativa
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Entra a Ordy Chat</title>
  <!--[if mso]><style>a{text-decoration:none}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#111827;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f5f5f7;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;width:100%;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(15,23,42,0.06);">
          <!-- Banda superior de color -->
          <tr>
            <td style="height:6px;background-color:${brand};background-image:linear-gradient(90deg,${brand},${accent});mso-line-height-rule:exactly;line-height:6px;font-size:0;">&nbsp;</td>
          </tr>
          <!-- Logo / marca -->
          <tr>
            <td style="padding:32px 40px 0 40px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="background-color:${brand};width:40px;height:40px;border-radius:10px;text-align:center;vertical-align:middle;color:#ffffff;font-size:20px;font-weight:700;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">O</td>
                  <td style="padding-left:12px;font-size:18px;font-weight:600;color:#111827;">Ordy Chat</td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Contenido -->
          <tr>
            <td style="padding:28px 40px 8px 40px;">
              <h1 style="margin:0 0 12px 0;font-size:24px;line-height:1.3;font-weight:700;color:#111827;">Entra a tu cuenta</h1>
              <p style="margin:0 0 28px 0;font-size:15px;line-height:1.6;color:#4b5563;">Pulsa el botón para iniciar sesión en Ordy Chat. Este enlace es válido durante 24 horas y solo se puede usar una vez.</p>
            </td>
          </tr>
          <!-- Botón bulletproof (tabla, no a display:inline-block) -->
          <tr>
            <td align="left" style="padding:0 40px 8px 40px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" bgcolor="${brand}" style="background-color:${brand};border-radius:10px;">
                    <a href="${url}" target="_blank" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;border:1px solid ${brandDark};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;mso-padding-alt:0;">
                      <!--[if mso]>&nbsp;&nbsp;&nbsp;&nbsp;<![endif]-->Entrar a Ordy Chat<!--[if mso]>&nbsp;&nbsp;&nbsp;&nbsp;<![endif]-->
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Fallback link discreto -->
          <tr>
            <td style="padding:24px 40px 8px 40px;">
              <p style="margin:0 0 8px 0;font-size:13px;line-height:1.5;color:#6b7280;">¿El botón no funciona? Copia y pega este enlace en tu navegador:</p>
              <p style="margin:0;font-size:12px;line-height:1.5;color:${brand};word-break:break-all;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;">${url}</p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:28px 40px 32px 40px;border-top:1px solid #f1f1f4;">
              <p style="margin:20px 0 0 0;font-size:12px;line-height:1.5;color:#9ca3af;">Enviado a <strong style="color:#6b7280;font-weight:600;">${email}</strong>. Si no solicitaste este correo puedes ignorarlo — nadie tendrá acceso a tu cuenta sin este enlace.</p>
            </td>
          </tr>
        </table>
        <!-- Línea fuera del card -->
        <p style="margin:20px 0 0 0;font-size:12px;color:#9ca3af;">Ordy Chat — Tu agente de WhatsApp con IA</p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: "super_admin" | "tenant_admin";
    } & DefaultSession["user"];
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  session: { strategy: ALLOW_DEV_LOGIN ? "jwt" : "database" },
  providers: [
    ...(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET
      ? [Google({
          clientId: process.env.AUTH_GOOGLE_ID,
          clientSecret: process.env.AUTH_GOOGLE_SECRET,
          allowDangerousEmailAccountLinking: true,
        })]
      : []),
    ...(process.env.AUTH_RESEND_KEY
      ? [Resend({
          apiKey: process.env.AUTH_RESEND_KEY,
          from: process.env.AUTH_EMAIL_FROM ?? "noreply@ordysuite.com",
          async sendVerificationRequest({ identifier: email, url, provider }) {
            const { host } = new URL(url);
            const res = await fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${provider.apiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                from: provider.from,
                to: email,
                subject: "Entra a Ordy Chat",
                html: renderMagicLinkEmail(url, email),
                text: `Entra a Ordy Chat\n\nHaz click en este enlace para iniciar sesión:\n${url}\n\nSi no solicitaste este correo puedes ignorarlo.\n\nHost: ${host}`,
              }),
            });
            if (!res.ok) {
              const body = await res.text().catch(() => "");
              throw new Error(`Resend send failed ${res.status}: ${body}`);
            }
          },
        })]
      : []),
    ...(ALLOW_DEV_LOGIN
      ? [
          Credentials({
            id: "dev",
            name: "Dev Login",
            credentials: { email: { label: "Email", type: "email" } },
            async authorize(creds) {
              const email = String(creds?.email ?? "").toLowerCase().trim();
              if (!email || !email.includes("@")) return null;
              // Mientras Resend no esté configurado, el dev login solo acepta el email del
              // super admin. Cierra la puerta abierta en prod hasta que exista magic link real.
              const superEmail = process.env.SUPER_ADMIN_EMAIL?.toLowerCase().trim();
              if (!superEmail || email !== superEmail) return null;
              const { eq } = await import("drizzle-orm");
              const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
              if (existing[0]) return existing[0];
              const [created] = await db.insert(users).values({ email, emailVerified: new Date() }).returning();
              return created;
            },
          }),
        ]
      : []),
  ],
  pages: {
    signIn: "/signin",
    verifyRequest: "/verify",
  },
  callbacks: {
    async session({ session, user, token }) {
      const userId = user?.id ?? (token?.sub as string | undefined);
      if (session.user && userId) {
        session.user.id = userId;
        const { eq } = await import("drizzle-orm");
        const [row] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1);
        session.user.role = (row?.role as "super_admin" | "tenant_admin") ?? "tenant_admin";
      }
      return session;
    },
    async signIn({ user }) {
      const superEmail = process.env.SUPER_ADMIN_EMAIL?.toLowerCase();
      if (user.email && superEmail && user.email.toLowerCase() === superEmail && user.id) {
        const { eq } = await import("drizzle-orm");
        await db.update(users).set({ role: "super_admin" }).where(eq(users.id, user.id));
      }
      return true;
    },
  },
});
