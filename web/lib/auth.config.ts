// web/lib/auth.config.ts — NextAuthConfig edge-safe.
//
// Este archivo lo importa `middleware.ts` (edge runtime). Edge NO puede
// importar módulos nativos (argon2, @neondatabase/serverless), así que aquí
// mantenemos SOLO: session strategy, pages, y un session callback que extrae
// el role del JWT (ya embebido por el callback jwt() de auth.ts).
//
// Los providers completos (Google, Resend, Credentials password, dev) +
// DrizzleAdapter + jwt callback con DB lookup viven en auth.ts (Node).

import type { NextAuthConfig, DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: "super_admin" | "tenant_admin" | "reseller";
    } & DefaultSession["user"];
  }
}

export const authConfig = {
  session: { strategy: "jwt" },
  pages: {
    signIn: "/signin",
    verifyRequest: "/verify",
  },
  providers: [],
  callbacks: {
    async session({ session, token }) {
      const userId = token?.sub as string | undefined;
      if (session.user && userId) {
        session.user.id = userId;
        const tokenRole = token?.role as string | undefined;
        session.user.role =
          (tokenRole as "super_admin" | "tenant_admin" | "reseller" | undefined) ??
          "tenant_admin";
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
