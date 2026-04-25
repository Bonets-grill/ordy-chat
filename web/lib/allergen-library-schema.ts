// web/lib/allergen-library-schema.ts
//
// Esquemas Zod para la biblioteca de alérgenos (mig 051).
// Reemplaza el text[] suelto que antes vivía en menu_items.allergens.

import { z } from "zod";

/** Slug estable: minúsculas, sin espacios, alfanumérico + guion bajo/medio. */
const codeSchema = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9_-]+$/, "code debe ser slug minúsculas (a-z, 0-9, _, -)");

export const allergenCreateSchema = z.object({
  code: codeSchema,
  label: z.string().min(1).max(80),
  icon: z.string().max(8).nullable().default(null),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
});

export const allergenPatchSchema = z
  .object({
    code: codeSchema.optional(),
    label: z.string().min(1).max(80).optional(),
    icon: z.string().max(8).nullable().optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "empty_patch" });

export const allergenAssignSchema = z.object({
  menuItemIds: z.array(z.string().uuid()).min(1).max(500),
  append: z.boolean().default(true),
});

export const itemAllergensReplaceSchema = z.object({
  allergenIds: z.array(z.string().uuid()).max(40),
});
