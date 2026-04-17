// web/lib/auth.ts — Auth.js v5 con Drizzle + magic link Resend.

import { DrizzleAdapter } from "@auth/drizzle-adapter";
import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Resend from "next-auth/providers/resend";
import { db } from "@/lib/db";
import { accounts, sessions, users, verificationTokens } from "@/lib/db/schema";

const ALLOW_DEV_LOGIN = process.env.ALLOW_DEV_LOGIN === "1";

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
      ? [Resend({ apiKey: process.env.AUTH_RESEND_KEY, from: process.env.AUTH_EMAIL_FROM ?? "noreply@ordychat.com" })]
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
