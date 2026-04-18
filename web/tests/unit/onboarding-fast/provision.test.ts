// web/tests/unit/onboarding-fast/provision.test.ts — Regresión del refactor fase 3.
//
// No mockeamos Drizzle (coste/frágil). Testamos las funciones puras que
// dominan la semántica del INSERT y comparamos el payload bit a bit con el
// que el wizard tradicional producía antes del refactor.
//
// La garantía de "wizard tradicional sigue funcionando" end-to-end la da el
// test E2E Playwright de fase 9.

import { describe, it, expect } from "vitest";
import {
  mapCanonicalToWizardFields,
  buildAgentConfigInsert,
  type ProvisionInput,
} from "@/lib/onboarding-fast/provision-mappers";

// Input equivalente al que el wizard tradicional siempre enviaba.
const wizardLegacyInput: ProvisionInput = {
  userId: "11111111-1111-1111-1111-111111111111",
  canonical: {
    name: "La Taberna",
    description: "Cocina mediterránea de proximidad.",
  },
  tone: "friendly",
  useCases: ["Responder preguntas frecuentes", "Tomar pedidos"],
  provider: "evolution",
  providerCredentials: {},
  knowledgeText: "Horario: L-V 13:00-16:00.",
  agentName: "Laura",
  schedule: "L-V 13:00-16:00",
};

describe("mapCanonicalToWizardFields", () => {
  it("mapea wizard legacy → estructura 1:1 con los defaults históricos", () => {
    const mapped = mapCanonicalToWizardFields(wizardLegacyInput);
    expect(mapped).toEqual({
      businessName: "La Taberna",
      businessDescription: "Cocina mediterránea de proximidad.",
      agentName: "Laura",
      tone: "friendly",
      schedule: "L-V 13:00-16:00",
      useCases: ["Responder preguntas frecuentes", "Tomar pedidos"],
      knowledgeText: "Horario: L-V 13:00-16:00.",
    });
  });

  it("agentName default 'Asistente' si el caller no lo pasa (fast onboarding)", () => {
    const mapped = mapCanonicalToWizardFields({
      ...wizardLegacyInput,
      agentName: undefined,
    });
    expect(mapped.agentName).toBe("Asistente");
  });

  it("schedule fallback: input.schedule > canonical.hours > '24/7'", () => {
    const onlyHours = mapCanonicalToWizardFields({
      ...wizardLegacyInput,
      schedule: undefined,
      canonical: { name: "X", hours: "9-18" },
    });
    expect(onlyHours.schedule).toBe("9-18");

    const nothing = mapCanonicalToWizardFields({
      ...wizardLegacyInput,
      schedule: undefined,
      canonical: { name: "X" },
    });
    expect(nothing.schedule).toBe("24/7");
  });

  it("businessDescription vacío si canonical.description ausente", () => {
    const mapped = mapCanonicalToWizardFields({
      ...wizardLegacyInput,
      canonical: { name: "Solo Nombre" },
    });
    expect(mapped.businessDescription).toBe("");
  });
});

describe("buildAgentConfigInsert — regresión legacy wizard", () => {
  const TENANT_ID = "22222222-2222-2222-2222-222222222222";
  const SYSTEM_PROMPT = "### SYSTEM PROMPT RENDERIZADO ###";

  it("produce el mismo payload que el wizard tradicional (pre-refactor)", () => {
    const payload = buildAgentConfigInsert(wizardLegacyInput, TENANT_ID, SYSTEM_PROMPT);

    // Snapshot explícito: este objeto es lo que iba al INSERT antes del refactor.
    expect(payload).toEqual({
      tenantId: TENANT_ID,
      businessName: "La Taberna",
      businessDescription: "Cocina mediterránea de proximidad.",
      agentName: "Laura",
      tone: "friendly",
      schedule: "L-V 13:00-16:00",
      useCases: ["Responder preguntas frecuentes", "Tomar pedidos"],
      systemPrompt: SYSTEM_PROMPT,
      fallbackMessage: "Disculpa, no entendí tu mensaje. ¿Podrías reformularlo?",
      errorMessage:
        "Lo siento, estoy teniendo problemas técnicos. Intenta de nuevo en unos minutos.",
      knowledge: [{ type: "text", content: "Horario: L-V 13:00-16:00." }],
      onboardingCompleted: true,
    });
  });

  it("knowledge = [] cuando knowledgeText es undefined", () => {
    const payload = buildAgentConfigInsert(
      { ...wizardLegacyInput, knowledgeText: undefined },
      TENANT_ID,
      SYSTEM_PROMPT,
    );
    expect(payload.knowledge).toEqual([]);
  });

  it("knowledge = [] cuando knowledgeText es string vacío", () => {
    const payload = buildAgentConfigInsert(
      { ...wizardLegacyInput, knowledgeText: "" },
      TENANT_ID,
      SYSTEM_PROMPT,
    );
    expect(payload.knowledge).toEqual([]);
  });

  it("preserva useCases exactamente (orden + contenido)", () => {
    const payload = buildAgentConfigInsert(
      {
        ...wizardLegacyInput,
        useCases: ["a", "b", "c", "b"],
      },
      TENANT_ID,
      SYSTEM_PROMPT,
    );
    expect(payload.useCases).toEqual(["a", "b", "c", "b"]);
  });

  it("onboardingCompleted siempre true (no hay wizard a medias)", () => {
    const payload = buildAgentConfigInsert(wizardLegacyInput, TENANT_ID, SYSTEM_PROMPT);
    expect(payload.onboardingCompleted).toBe(true);
  });

  it("acepta los 4 tones sin romper la forma del payload", () => {
    const tones = ["professional", "friendly", "sales", "empathetic"] as const;
    for (const t of tones) {
      const p = buildAgentConfigInsert(
        { ...wizardLegacyInput, tone: t },
        TENANT_ID,
        SYSTEM_PROMPT,
      );
      expect(p.tone).toBe(t);
    }
  });
});

describe("buildAgentConfigInsert — fast onboarding (CanonicalBusiness rico)", () => {
  it("acepta canonical con campos extra (phone, hours, rating...) sin romper", () => {
    const fastInput: ProvisionInput = {
      userId: "33333333-3333-3333-3333-333333333333",
      canonical: {
        name: "Restaurante El Puerto",
        description: "Cocina mediterránea desde 1987.",
        phone: "+34 912 345 678",
        email: "info@elpuerto.es",
        hours: "L-V 12:00-23:30",
        website: "https://elpuerto.es",
        rating: 4.6,
        reviews_count: 1234,
      },
      tone: "professional",
      useCases: ["Reservas"],
      provider: "evolution",
    };
    const payload = buildAgentConfigInsert(fastInput, "tenant-x", "PROMPT");
    expect(payload.businessName).toBe("Restaurante El Puerto");
    // schedule: no se pasó explícito → fallback a canonical.hours
    expect(payload.schedule).toBe("L-V 12:00-23:30");
    // Campos extra del canonical NO contaminan agent_configs (no existen columnas).
    expect(Object.keys(payload)).not.toContain("phone");
    expect(Object.keys(payload)).not.toContain("rating");
  });
});
