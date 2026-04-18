"use client";

import { signIn } from "next-auth/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function SignInForm() {
  const params = useSearchParams();
  const from = params.get("from") ?? "/onboarding";
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  const devMode =
    process.env.NODE_ENV === "development" || process.env.NEXT_PUBLIC_ALLOW_DEV_LOGIN === "1";
  const googleEnabled = process.env.NEXT_PUBLIC_AUTH_GOOGLE_ENABLED === "1";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const provider = devMode ? "dev" : "resend";
    await signIn(provider, { email, callbackUrl: from });
  }

  async function onGoogle() {
    setLoading(true);
    await signIn("google", { callbackUrl: from });
  }

  return (
    <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4 rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm">
      <div>
        <h1 className="text-2xl font-semibold text-neutral-900">Entra a Ordy Chat</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {devMode ? "Accede con tu email — modo demo sin verificación." : "Te mandamos un enlace mágico a tu email."}
        </p>
      </div>
      {devMode && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
          🚧 <strong>Modo demo restringido.</strong> Solo el email del super admin puede entrar mientras se configura el envío de magic link.
        </div>
      )}
      {googleEnabled && (
        <>
          <button
            type="button"
            onClick={onGoogle}
            disabled={loading}
            className="flex w-full items-center justify-center gap-3 rounded-full border border-neutral-200 bg-white px-5 py-3 text-sm font-medium text-neutral-900 transition hover:bg-neutral-50 disabled:opacity-50"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.616z"/>
              <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z"/>
              <path fill="#FBBC05" d="M3.964 10.706A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"/>
              <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.962L3.964 7.294C4.672 5.167 6.656 3.58 9 3.58z"/>
            </svg>
            Continuar con Google
          </button>
          <div className="flex items-center gap-3 text-xs text-neutral-400">
            <div className="h-px flex-1 bg-neutral-200" />
            <span>o</span>
            <div className="h-px flex-1 bg-neutral-200" />
          </div>
        </>
      )}
      <Input
        type="email"
        required
        placeholder="tu@empresa.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <Button type="submit" variant="brand" size="lg" className="w-full" disabled={loading}>
        {loading ? "Entrando…" : devMode ? "Entrar" : "Enviar enlace"}
      </Button>
      <p className="text-center text-xs text-neutral-500">
        Al entrar aceptas los <Link href="/terms" className="underline">términos</Link> y la{" "}
        <Link href="/privacy" className="underline">privacidad</Link>.
      </p>
    </form>
  );
}

export default function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-subtle px-4">
      <Suspense fallback={<div className="text-sm text-neutral-500">Cargando…</div>}>
        <SignInForm />
      </Suspense>
    </div>
  );
}
