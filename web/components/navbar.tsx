import Link from "next/link";
import { Button } from "./ui/button";

export function Navbar() {
  return (
    <header className="sticky top-0 z-40 border-b border-white/5 bg-black/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight text-white">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-brand-600 to-accent-pink text-white">
            O
          </span>
          Ordy Chat
        </Link>
        <nav className="hidden items-center gap-8 text-sm text-white/70 md:flex">
          <Link href="/#features" className="hover:text-white">Características</Link>
          <Link href="/#niches" className="hover:text-white">Nichos</Link>
          <Link href="/pricing" className="hover:text-white">Precio</Link>
          <Link href="/#faq" className="hover:text-white">FAQ</Link>
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/signin" className="hidden text-sm font-medium text-white/70 hover:text-white md:inline">
            Iniciar sesión
          </Link>
          <Button
            asChild
            size="sm"
            className="bg-white text-black hover:bg-white/90"
          >
            <Link href="/signin?from=/onboarding">Empezar gratis</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
