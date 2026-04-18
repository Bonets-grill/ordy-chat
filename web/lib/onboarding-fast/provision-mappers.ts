// web/lib/onboarding-fast/provision-mappers.ts — Mappers puros (sin DB).
//
// Separado de provision.ts para poder testear sin que el import de `@/lib/db`
// dispare la validación de DATABASE_URL en el entorno de tests.

import type { CanonicalBusiness } from "./canonical";

export type ProvisionProvider = "evolution" | "whapi" | "meta" | "twilio";
export type ProvisionTone = "professional" | "friendly" | "sales" | "empathetic";

export type ProvisionInput = {
  userId: string;
  canonical: CanonicalBusiness;
  tone: ProvisionTone;
  useCases: string[];
  provider: ProvisionProvider;
  providerCredentials?: Record<string, string>;
  knowledgeText?: string;
  agentName?: string;
  schedule?: string;
};

export type ProvisionResult = {
  slug: string;
  tenantId: string;
  qrUrl?: string;
};

export type AgentWizardFields = {
  businessName: string;
  businessDescription: string;
  agentName: string;
  tone: ProvisionTone;
  schedule: string;
  useCases: string[];
  knowledgeText?: string;
};

/** Mapea ProvisionInput → campos legacy que `buildSystemPrompt` espera. */
export function mapCanonicalToWizardFields(input: ProvisionInput): AgentWizardFields {
  return {
    businessName: input.canonical.name,
    businessDescription: input.canonical.description ?? "",
    agentName: input.agentName ?? "Asistente",
    tone: input.tone,
    schedule: input.schedule ?? input.canonical.hours ?? "24/7",
    useCases: input.useCases,
    knowledgeText: input.knowledgeText,
  };
}

/** Payload INSERT para agent_configs. Determinista. */
export function buildAgentConfigInsert(
  input: ProvisionInput,
  tenantId: string,
  systemPrompt: string,
) {
  return {
    tenantId,
    businessName: input.canonical.name,
    businessDescription: input.canonical.description ?? "",
    agentName: input.agentName ?? "Asistente",
    tone: input.tone,
    schedule: input.schedule ?? input.canonical.hours ?? "24/7",
    useCases: input.useCases,
    systemPrompt,
    fallbackMessage: "Disculpa, no entendí tu mensaje. ¿Podrías reformularlo?",
    errorMessage:
      "Lo siento, estoy teniendo problemas técnicos. Intenta de nuevo en unos minutos.",
    knowledge: input.knowledgeText ? [{ type: "text", content: input.knowledgeText }] : [],
    onboardingCompleted: true,
  };
}
