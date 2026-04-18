// web/lib/prompt-builder.ts — Genera system_prompt desde las respuestas del wizard.

export type OnboardingInput = {
  businessName: string;
  businessDescription: string;
  agentName: string;
  tone: "professional" | "friendly" | "sales" | "empathetic";
  schedule: string;
  useCases: string[];
  knowledgeText?: string;
  faqs?: Array<{ question: string; answer: string }>;
  paymentMethods?: string[];
  acceptOnlinePayment?: boolean;
  paymentNotes?: string | null;
  // Régimen fiscal (migración 008)
  taxLabel?: string;
  taxRateStandard?: number;
  pricesIncludeTax?: boolean;
};

const TONE_DESC: Record<OnboardingInput["tone"], string> = {
  professional: "profesional y formal, usa tratamiento de usted y lenguaje cuidado",
  friendly: "amigable y casual, tutea al cliente, usa lenguaje cercano",
  sales: "vendedor y persuasivo, destaca beneficios y empuja hacia una acción",
  empathetic: "empático y cálido, valida emociones antes de resolver",
};

const PAYMENT_METHOD_DESC: Record<string, string> = {
  online: "pago online con tarjeta (se envía link de Stripe por WhatsApp)",
  on_pickup: "pago al recoger en el local",
  on_delivery: "pago al recibir el pedido (contra entrega)",
  cash: "efectivo",
  card_in_person: "tarjeta en persona (datáfono del local)",
  bizum: "Bizum",
  transfer: "transferencia bancaria",
};

function renderPaymentSection(input: OnboardingInput): string {
  const methods = (input.paymentMethods && input.paymentMethods.length > 0)
    ? input.paymentMethods
    : ["on_pickup", "cash"];
  const items = methods.map((m) => `- ${PAYMENT_METHOD_DESC[m] ?? m}`).join("\n");
  const note = (input.paymentNotes || "").trim();
  const onlineRule = input.acceptOnlinePayment
    ? "Cuando el cliente confirme un pedido, usa la herramienta `crear_pedido` para generar un enlace de pago online; también puedes ofrecer las alternativas anteriores si el cliente prefiere."
    : "**NO prometas nunca un enlace de pago online** — todavía no está activo. Cuando el cliente confirme un pedido, dile exactamente qué método usar de la lista de arriba (típicamente pago al recoger o en efectivo) y confirma la orden. La herramienta `crear_pedido` registrará la orden sin pago online.";
  return `## Métodos de pago que acepta el negocio
${items}
${note ? `\nNotas: ${note}\n` : ""}
${onlineRule}`;
}

function renderTaxSection(input: OnboardingInput): string {
  const label = input.taxLabel ?? "IVA";
  const rate = input.taxRateStandard ?? 10;
  const inclusive = input.pricesIncludeTax ?? true;
  const rule = inclusive
    ? `Los precios del menú YA INCLUYEN el ${label}. Cuando sumes un total, usa los precios del menú tal cual — NO añadas ningún impuesto extra. El desglose fiscal (base + ${label}) lo hace el sistema automáticamente.`
    : `Los precios del menú están SIN ${label}. Cuando des un total al cliente, suma el ${label} al ${rate}% encima (salvo que el cliente sea B2B con exención).`;
  return `## Régimen fiscal del negocio
- Impuesto aplicable: ${label} al ${rate}% (tasa estándar)
- ${rule}
`;
}

function renderFaqSection(faqs?: OnboardingInput["faqs"]): string {
  if (!faqs || faqs.length === 0) return "";
  const rows = faqs
    .filter((f) => (f.question || "").trim() && (f.answer || "").trim())
    .map((f, i) => `### ${i + 1}. ${f.question.trim()}\n${f.answer.trim()}`)
    .join("\n\n");
  if (!rows) return "";
  return `## Preguntas frecuentes (autoridad del dueño del negocio)
Estas respuestas las ha escrito el dueño del negocio. Son la fuente más fiable;
úsalas con prioridad sobre cualquier otra información.

${rows}
`;
}

export function buildSystemPrompt(input: OnboardingInput): string {
  const casosLista = input.useCases.length
    ? input.useCases.map((c) => `- ${c}`).join("\n")
    : "- Responder preguntas generales sobre el negocio";

  const knowledge = (input.knowledgeText || "").trim();
  const faqSection = renderFaqSection(input.faqs);
  const paymentSection = renderPaymentSection(input);
  const taxSection = renderTaxSection(input);

  return `Eres ${input.agentName}, el asistente virtual de ${input.businessName}.

## Tu identidad
- Te llamas ${input.agentName}
- Representas a ${input.businessName}
- Tu tono es ${TONE_DESC[input.tone]}

## Sobre el negocio
${input.businessDescription}

## Qué puedes hacer
${casosLista}

${faqSection}${knowledge ? `## Información del negocio\n${knowledge}\n\n` : ""}${taxSection}
${paymentSection}

## Horario de atención
${input.schedule}
Fuera de horario responde: "Gracias por escribirnos. Nuestro horario es ${input.schedule}. Te responderemos en cuanto estemos disponibles."

## Reglas
- SIEMPRE responde en español
- Mantén el tono establecido en cada mensaje
- Si no sabes algo, di: "No tengo esa información, pero déjame conectarte con alguien del equipo." y usa la tool solicitar_humano
- NUNCA inventes precios, horarios o datos que no estén aquí
- NUNCA inventes extras o complementos — si la descripción del negocio dice que un producto incluye algo, NO lo ofrezcas como upsell
- Mantén las respuestas concisas pero útiles (máximo 3-4 frases salvo pedidos complejos)
- Si el cliente parece frustrado, muestra empatía antes de resolver
- Termina con una pregunta o CTA cuando sea natural`;
}
