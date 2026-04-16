// web/lib/auth.ts — Auth.js v5 con Drizzle + magic link Resend.

import { DrizzleAdapter } from "@auth/drizzle-adapter";
import NextAuth, { type DefaultSession } from "next-auth";
import Resend from "next-auth/providers/resend";
import { db } from "@/lib/db";
import { accounts, sessions, users, verificationTokens } from "@/lib/db/schema";

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
  session: { strategy: "database" },
  providers: [
    Resend({
      apiKey: process.env.AUTH_RESEND_KEY,
      from: process.env.AUTH_EMAIL_FROM ?? "noreply@ordychat.com",
    }),
  ],
  pages: {
    signIn: "/signin",
    verifyRequest: "/verify",
  },
  callbacks: {
    async session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
        session.user.role = (user as { role?: "super_admin" | "tenant_admin" }).role ?? "tenant_admin";
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
