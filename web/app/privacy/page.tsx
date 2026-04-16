import { Footer } from "@/components/footer";
import { Navbar } from "@/components/navbar";

export const metadata = { title: "Política de privacidad — Ordy Chat" };

export default function PrivacyPage() {
  return (
    <>
      <Navbar />
      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-4xl font-semibold text-neutral-900">Política de privacidad</h1>
        <p className="mt-2 text-sm text-neutral-500">Última actualización: 16 de abril de 2026</p>

        <div className="prose prose-neutral mt-8 max-w-none space-y-6 text-neutral-700">
          <section>
            <h2 className="text-xl font-semibold text-neutral-900">1. Datos que recopilamos</h2>
            <ul className="list-disc pl-6">
              <li>Email y nombre al crear la cuenta.</li>
              <li>Datos del negocio que tú introduces (nombre, descripción, horario, base de conocimiento).</li>
              <li>Credenciales de tus proveedores (Anthropic, Whapi/Meta/Twilio) — guardadas cifradas con AES-256-GCM.</li>
              <li>Datos de pago procesados por Stripe (no almacenamos la tarjeta).</li>
              <li>Mensajes intercambiados entre tu agente y tus clientes de WhatsApp.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-neutral-900">2. Para qué los usamos</h2>
            <p>Únicamente para hacer funcionar tu agente, procesar pagos y atenderte como cliente. No vendemos ni compartimos tus datos con terceros con fines comerciales.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-neutral-900">3. Subencargados</h2>
            <ul className="list-disc pl-6">
              <li><strong>Anthropic</strong> — procesa los mensajes para generar respuestas del agente.</li>
              <li><strong>WhatsApp / Whapi / Meta / Twilio</strong> — canal de comunicación con tus clientes.</li>
              <li><strong>Neon</strong> — base de datos.</li>
              <li><strong>Stripe</strong> — pagos.</li>
              <li><strong>Resend</strong> — envío de emails transaccionales.</li>
              <li><strong>Vercel / Railway</strong> — hosting.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-neutral-900">4. Retención</h2>
            <p>Mantenemos tus datos mientras tu cuenta esté activa. Al cancelar, los borramos en un plazo de 30 días salvo que tengamos obligación legal de conservarlos (p. ej. facturación).</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-neutral-900">5. Tus derechos (RGPD)</h2>
            <p>Tienes derecho a acceder, rectificar, suprimir, portabilidad, oposición y limitación del tratamiento. Escríbenos a <a href="mailto:privacidad@ordychat.com" className="underline">privacidad@ordychat.com</a>.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-neutral-900">6. Seguridad</h2>
            <p>Credenciales sensibles cifradas con AES-256-GCM. Conexiones TLS obligatorias. Segregación multi-tenant en base de datos.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-neutral-900">7. Cookies</h2>
            <p>Usamos cookies esenciales para el login (sesión de Auth.js). No usamos cookies de publicidad ni tracking de terceros.</p>
          </section>
        </div>
      </main>
      <Footer />
    </>
  );
}
