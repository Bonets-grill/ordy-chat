import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Navbar } from "@/components/navbar";

export default function NotFound() {
  return (
    <>
      <Navbar />
      <main className="mx-auto flex min-h-[60vh] max-w-3xl flex-col items-center justify-center px-6 py-24 text-center">
        <p className="text-sm font-semibold uppercase tracking-wide text-brand-600">Error 404</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-neutral-900 sm:text-5xl">
          Esta página no existe
        </h1>
        <p className="mt-4 max-w-xl text-base text-neutral-600">
          El enlace que has seguido está roto o la página se ha movido. Puedes volver al inicio o ver nuestros planes.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button asChild variant="brand" size="lg">
            <Link href="/">Volver al inicio</Link>
          </Button>
          <Button asChild variant="secondary" size="lg">
            <Link href="/pricing">Ver precio</Link>
          </Button>
        </div>
      </main>
    </>
  );
}
