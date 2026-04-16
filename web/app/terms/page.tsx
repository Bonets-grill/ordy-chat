import { Footer } from "@/components/footer";
import { Navbar } from "@/components/navbar";

export const metadata = { title: "Términos y condiciones — Ordy Chat" };

export default function TermsPage() {
  return (
    <>
      <Navbar />
      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-4xl font-semibold text-neutral-900">Términos y condiciones</h1>
        <p className="mt-2 text-sm text-neutral-500">Última actualización: 16 de abril de 2026</p>

        <div className="prose prose-neutral mt-8 max-w-none space-y-6 text-neutral-700">
          <section>
            <h2 className="text-xl font-semibold text-neutral-900">1. Aceptación</h2>
            <p>Al acceder o usar Ordy Chat (&ldquo;el servicio&rdquo;) aceptas estos Términos. Si no estás de acuerdo, no uses el servicio.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-neutral-900">2. Qué es Ordy Chat</h2>
            <p>Ordy Chat es una plataforma SaaS que permite a negocios operar un agente de WhatsApp basado en IA para atender a sus clientes. Nosotros operamos la infraestructura; tú configuras el agente, las credenciales de WhatsApp y decides qué responde.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-neutral-900">3. Suscripción y pagos</h2>
            <p>El precio es €19.90/mes, facturado por Stripe. Ofrecemos 7 días de prueba gratuita al inicio. Puedes cancelar cuando quieras desde tu panel; la suscripción queda activa hasta el final del periodo pagado.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-neutral-900">4. Responsabilidad del contenido</h2>
            <p>Eres responsable de todo lo que el agente responde a tus clientes. Ordy Chat genera respuestas con IA basadas en el prompt y el contexto que tú proporcionas; no garantizamos la exactitud de cada respuesta.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-neutral-900">5. Uso aceptable</h2>
            <p>No puedes usar Ordy Chat para enviar spam, mensajes ilegales, contenido engañoso, servicios financieros no regulados, ni para actividades que violen los términos de WhatsApp o de tu proveedor (Whapi, Meta o Twilio).</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-neutral-900">6. Privacidad</h2>
            <p>El tratamiento de datos personales se rige por nuestra <a href="/privacy" className="underline">Política de privacidad</a>.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-neutral-900">7. Limitación de responsabilidad</h2>
            <p>Ordy Chat se proporciona &ldquo;tal cual&rdquo;. No respondemos por lucro cesante, pérdida de datos, ni por el comportamiento de tus proveedores externos (Anthropic, WhatsApp, Stripe).</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-neutral-900">8. Cancelación y rescisión</h2>
            <p>Podemos suspender cuentas que violen estos términos. Tú puedes borrar tu cuenta en cualquier momento contactando con soporte.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-neutral-900">9. Ley aplicable</h2>
            <p>Estos términos se rigen por la legislación española. Cualquier disputa se someterá a los juzgados de la residencia del titular del servicio.</p>
          </section>
        </div>
      </main>
      <Footer />
    </>
  );
}
