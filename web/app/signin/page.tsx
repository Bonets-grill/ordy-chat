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

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const provider = devMode ? "dev" : "resend";
    await signIn(provider, { email, callbackUrl: from });
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
