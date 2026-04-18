// web/lib/onboarding-fast/canonical.ts — Schema Zod único del "negocio canónico".
//
// Fuente de verdad de los campos que el onboarding fast extrae, fusiona y
// confirma. Todas las fronteras (API routes, merger LLM, provision) validan
// contra este schema. Cambios aquí repercuten en:
//   - lib/scraper/google-business.ts + tripadvisor.ts (salida Partial<>)
//   - lib/onboarding-fast/merger.ts (entrada + salida)
//   - lib/onboarding-fast/provision.ts (entrada)
//   - API routes /onboarding/fast/* (validación body)
//
// NOTA legal (auditoría 2026-04-18): fotos_urls FUE removido del schema.
// Razón: las fotos scrapeadas de Google/TripAdvisor pueden contener rostros
// de clientes → art.6 RGPD + hotlinking de CDNs de terceros. Si en el futuro
// se re-añade, registrar base legal + CSP restrictiva img-src.

import { z } from "zod";

export const CategoryItemSchema = z.object({
  name: z.string().min(1).max(200),
  price: z.string().max(40).optional(),
  description: z.string().max(500).optional(),
  allergens: z.array(z.string().max(40)).max(20).optional(),
});

export const CategorySchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  items: z.array(CategoryItemSchema).max(100).optional(),
});

export const CanonicalBusinessSchema = z.object({
  name: z.string().min(2).max(200),
  description: z.string().max(2000).optional(),
  phone: z.string().max(40).optional(),
  email: z.string().email().optional(),
  address: z.string().max(500).optional(),
  // Horario como string libre. El merger respeta el formato humano de cada
  // fuente ("L-V 9:00-18:00", "Mon-Fri 9am-6pm"); la normalización final la
  // hace el tenant si quiere.
  hours: z.string().max(500).optional(),
  website: z.string().url().optional(),
  // social: { instagram: "https://…", facebook: "https://…" }
  social: z.record(z.string().max(30), z.string().url()).optional(),
  categories: z.array(CategorySchema).max(50).optional(),
  rating: z.number().min(0).max(5).optional(),
  reviews_count: z.number().int().nonnegative().max(10_000_000).optional(),
  payment_methods: z.array(z.string().max(40)).max(20).optional(),
});

export type CategoryItem = z.infer<typeof CategoryItemSchema>;
export type Category = z.infer<typeof CategorySchema>;
export type CanonicalBusiness = z.infer<typeof CanonicalBusinessSchema>;

// Nombres canónicos de campo usados en el merger y en la UI de conflictos.
// Mantén sincronizado con CanonicalBusinessSchema.
export const CANONICAL_FIELDS = [
  "name",
  "description",
  "phone",
  "email",
  "address",
  "hours",
  "website",
  "social",
  "categories",
  "rating",
  "reviews_count",
  "payment_methods",
] as const;

export type CanonicalField = (typeof CANONICAL_FIELDS)[number];

// Helper para validar con mensaje de error legible.
export function parseCanonical(input: unknown): CanonicalBusiness {
  return CanonicalBusinessSchema.parse(input);
}

export function safeParseCanonical(input: unknown) {
  return CanonicalBusinessSchema.safeParse(input);
}
