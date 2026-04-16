import Link from "next/link";
import { Button } from "./ui/button";

export function Navbar() {
  return (
    <header className="sticky top-0 z-40 border-b border-neutral-200/60 bg-white/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight text-neutral-900">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-brand-600 to-accent-pink text-white">
            O
          </span>
          Ordy Chat
        </Link>
        <nav className="hidden items-center gap-8 text-sm text-neutral-600 md:flex">
          <Link href="/#features" className="hover:text-neutral-900">Características</Link>
          <Link href="/#niches" className="hover:text-neutral-900">Nichos</Link>
          <Link href="/pricing" className="hover:text-neutral-900">Precio</Link>
          <Link href="/#faq" className="hover:text-neutral-900">FAQ</Link>
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/signin" className="hidden text-sm font-medium text-neutral-700 hover:text-neutral-900 md:inline">
            Iniciar sesión
          </Link>
          <Button asChild variant="primary" size="sm">
            <Link href="/signin?from=/onboarding">Empezar gratis</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
