// web/lib/auth.ts — Auth.js v5 con Drizzle + magic link Resend.

import { DrizzleAdapter } from "@auth/drizzle-adapter";
import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Resend from "next-auth/providers/resend";
import { db } from "@/lib/db";
import { accounts, sessions, users, verificationTokens } from "@/lib/db/schema";

const ALLOW_DEV_LOGIN = process.env.ALLOW_DEV_LOGIN === "1";

function renderMagicLinkEmail(url: string, email: string): string {
  // Email minimal, inline styles (clientes de correo no soportan <style> bien).
  return `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fff;border-radius:16px;padding:40px 32px;box-shadow:0 1px 3px rgba(0,0,0,0.05)">
        <tr><td style="padding-bottom:24px">
          <div style="font-size:22px;font-weight:600;color:#111">Ordy Chat</div>
        </td></tr>
        <tr><td>
          <h1 style="margin:0 0 8px;font-size:24px;font-weight:600;color:#111">Entra a tu cuenta</h1>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.5;color:#525252">Haz click en el botón para iniciar sesión en Ordy Chat. Este enlace es válido por 24 horas.</p>
          <a href="${url}" style="display:inline-block;background:linear-gradient(90deg,#7c3aed,#ec4899);color:#fff;text-decoration:none;padding:14px 28px;border-radius:10px;font-weight:600;font-size:15px">Entrar a Ordy Chat</a>
          <p style="margin:24px 0 0;font-size:13px;color:#737373;line-height:1.5">¿El botón no funciona? Copia y pega este enlace en tu navegador:<br><span style="color:#525252;word-break:break-all">${url}</span></p>
        </td></tr>
        <tr><td style="padding-top:32px;border-top:1px solid #f0f0f0;margin-top:32px">
          <p style="margin:16px 0 0;font-size:12px;color:#a3a3a3;line-height:1.5">Enviado a ${email}. Si no solicitaste este correo, ignóralo — nadie tendrá acceso a tu cuenta.</p>
        </td></tr>
      </table>
    </td></tr>
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
