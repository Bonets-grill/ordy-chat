import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-neutral-200 bg-white py-12">
      <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-8 px-6 md:flex-row md:items-center">
        <div>
          <div className="flex items-center gap-2 text-lg font-semibold text-neutral-900">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-brand-600 to-accent-pink text-white">O</span>
            Ordy Chat
          </div>
          <p className="mt-2 max-w-sm text-sm text-neutral-500">
            Agentes de WhatsApp con IA para cualquier negocio. Configurables en minutos.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-8 text-sm">
          <div className="space-y-2">
            <div className="font-semibold text-neutral-900">Producto</div>
            <Link href="/#features" className="block text-neutral-600 hover:text-neutral-900">Características</Link>
            <Link href="/pricing" className="block text-neutral-600 hover:text-neutral-900">Precio</Link>
          </div>
          <div className="space-y-2">
            <div className="font-semibold text-neutral-900">Legal</div>
            <Link href="/terms" className="block text-neutral-600 hover:text-neutral-900">Términos</Link>
            <Link href="/privacy" className="block text-neutral-600 hover:text-neutral-900">Privacidad</Link>
          </div>
        </div>
      </div>
      <div className="mx-auto mt-8 max-w-6xl px-6 text-xs text-neutral-400">
        © {new Date().getFullYear()} Ordy Chat. Todos los derechos reservados.
      </div>
    </footer>
  );
}
