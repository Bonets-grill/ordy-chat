// web/lib/modifier-library-schema.ts
//
// Esquemas Zod compartidos para la biblioteca de modificadores (mig 051).
// Separado de menu-modifiers-schema (legacy 1:1) porque el modelo de datos cambió:
// el grupo ahora vive a nivel tenant y se asigna a N productos vía link table.

import { z } from "zod";

export const optionInputSchema = z.object({
  name: z.string().min(1).max(120),
  /** Solo positivos o cero. Negativos se rechazan en API y CHECK en DB. */
  priceDeltaCents: z.number().int().min(0).max(100_000),
  available: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
});

export const optionPatchSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    priceDeltaCents: z.number().int().min(0).max(100_000).optional(),
    available: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "empty_patch" });

export const groupCreateSchema = z
  .object({
    name: z.string().min(1).max(120),
    selectionType: z.enum(["single", "multi"]),
    required: z.boolean().default(false),
    minSelect: z.number().int().min(0).max(20).default(0),
    /** null = sin límite (multi). Para single forzamos a 1 a nivel servidor. */
    maxSelect: z.number().int().min(1).max(20).nullable().default(null),
    sortOrder: z.number().int().min(0).max(10_000).default(0),
    /** Opciones iniciales — atajo UX para crear grupo+opciones en un POST. */
    options: z.array(optionInputSchema).max(50).default([]),
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

/** Asignación masiva: aplica este grupo a una lista de productos del tenant. */
export const groupAssignSchema = z.object({
  menuItemIds: z.array(z.string().uuid()).min(1).max(500),
  /** Si true, añade además de las asignaciones existentes. Si false, reemplaza
   * el conjunto completo de productos asignados a este grupo. */
  append: z.boolean().default(true),
});

/** Reemplaza el conjunto completo de grupos asignados a un producto. */
export const itemLinksReplaceSchema = z.object({
  groupIds: z.array(z.string().uuid()).max(50),
});

/** Configura la dependencia condicional de un link concreto. */
export const linkDependencyPatchSchema = z.object({
  dependsOnOptionId: z.string().uuid().nullable(),
});
