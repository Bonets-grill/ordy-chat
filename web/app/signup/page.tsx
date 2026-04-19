"use client";

import { signIn } from "next-auth/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Issues = Partial<Record<"email" | "password" | "name" | "confirm", string>>;

function SignUpForm() {
  const params = useSearchParams();
  const from = params.get("from") ?? "/onboarding";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<Issues>({});

  function clientValidate(): Issues {
    const i: Issues = {};
    if (!name.trim()) i.name = "Di cómo te llamas.";
    if (!email.includes("@")) i.email = "Email no válido.";
    if (password.length < 8) i.password = "Mínimo 8 caracteres.";
    if (password !== confirm) i.confirm = "Las contraseñas no coinciden.";
    return i;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const clientIssues = clientValidate();
    setIssues(clientIssues);
    if (Object.keys(clientIssues).length > 0) return;

    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password, name: name.trim() }),
      });
      if (res.status === 409) {
        setError("Ese email ya tiene cuenta. Entra en lugar de registrarte.");
        setLoading(false);
        return;
      }
      if (res.status === 429) {
        setError("Demasiados intentos desde tu red. Espera unos minutos.");
        setLoading(false);
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body?.issues) setIssues(body.issues);
        setError("No se pudo crear la cuenta. Revisa los campos.");
        setLoading(false);
        return;
      }

      // Auto-login con las mismas credenciales. El backend ya hizo emailVerified.
      const login = await signIn("password", {
        email: email.trim().toLowerCase(),
        password,
        redirect: false,
        callbackUrl: from,
      });
      if (!login || login.error) {
        // Cuenta creada pero login falló → manda a /signin para reintento manual.
        window.location.href = "/signin?created=1";
        return;
      }
      window.location.href = login.url ?? from;
    } catch {
      setError("Algo ha fallado. Inténtalo de nuevo.");
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="w-full max-w-sm space-y-4 rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm"
    >
      <div>
        <h1 className="text-2xl font-semibold text-neutral-900">Crea tu cuenta</h1>
        <p className="mt-1 text-sm text-neutral-500">En 30 segundos tienes tu Ordy Chat listo.</p>
      </div>
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700" role="alert">
          {error}
        </div>
      )}
      <div>
        <Input
          type="text"
          required
          autoComplete="name"
          placeholder="Tu nombre"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        {issues.name && <p className="mt-1 text-xs text-red-600">{issues.name}</p>}
      </div>
      <div>
        <Input
          type="email"
          required
          autoComplete="email"
          placeholder="tu@empresa.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {issues.email && <p className="mt-1 text-xs text-red-600">{issues.email}</p>}
      </div>
      <div>
        <Input
          type="password"
          required
          autoComplete="new-password"
          minLength={8}
          placeholder="Contraseña (≥ 8 caracteres)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {issues.password && <p className="mt-1 text-xs text-red-600">{issues.password}</p>}
      </div>
      <div>
        <Input
          type="password"
          required
          autoComplete="new-password"
          minLength={8}
          placeholder="Repite la contraseña"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        {issues.confirm && <p className="mt-1 text-xs text-red-600">{issues.confirm}</p>}
      </div>
      <Button type="submit" variant="brand" size="lg" className="w-full" disabled={loading}>
        {loading ? "Creando cuenta…" : "Crear cuenta"}
      </Button>
      <p className="text-center text-xs text-neutral-500">
        ¿Ya tienes cuenta?{" "}
        <Link href="/signin" className="font-medium text-brand-600 hover:underline">
          Entra
        </Link>
      </p>
      <p className="text-center text-xs text-neutral-500">
        Al registrarte aceptas los <Link href="/terms" className="underline">términos</Link> y la{" "}
        <Link href="/privacy" className="underline">privacidad</Link>.
      </p>
    </form>
  );
}

export default function SignUpPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-subtle px-4">
      <Suspense fallback={<div className="text-sm text-neutral-500">Cargando…</div>}>
        <SignUpForm />
      </Suspense>
    </div>
  );
}
