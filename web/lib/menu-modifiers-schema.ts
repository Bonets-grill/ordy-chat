// web/lib/menu-modifiers-schema.ts
//
// Esquemas Zod compartidos para los modificadores de la carta (mig 042).
// Vive en /lib/ para poder importarlos desde rutas de API y desde tests sin
// arrastrar dependencias de @/lib/db (que requiere DATABASE_URL en runtime).

import { z } from "zod";

export const modifierInputSchema = z.object({
  name: z.string().min(1).max(120),
  /** Solo positivos o cero. Negativos se rechazan a nivel API y CHECK en DB. */
  priceDeltaCents: z.number().int().min(0).max(100_000),
  available: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
});

export const groupCreateSchema = z
  .object({
    name: z.string().min(1).max(120),
    selectionType: z.enum(["single", "multi"]),
    required: z.boolean().default(false),
    minSelect: z.number().int().min(0).max(20).default(0),
    /** null = sin límite (multi). Para single forzamos a 1 a nivel servidor. */
    maxSelect: z.number().int().min(1).max(20).nullable().default(null),
    sortOrder: z.number().int().min(0).max(10_000).default(0),
    modifiers: z.array(modifierInputSchema).max(50).default([]),
  })
  .superRefine((val, ctx) => {
    if (val.selectionType === "single" && val.maxSelect !== null && val.maxSelect !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxSelect"],
        message: "single requiere maxSelect=1 o null",
      });
    }
    if (val.maxSelect !== null && val.minSelect > val.maxSelect) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["minSelect"],
        message: "minSelect no puede superar maxSelect",
      });
    }
  });

export const groupPatchSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    selectionType: z.enum(["single", "multi"]).optional(),
    required: z.boolean().optional(),
    minSelect: z.number().int().min(0).max(20).optional(),
    maxSelect: z.number().int().min(1).max(20).nullable().optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "empty_patch" });

export const modifierPatchSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    priceDeltaCents: z.number().int().min(0).max(100_000).optional(),
    available: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "empty_patch" });
