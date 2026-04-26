# shared/migrations

SQL migrations para Neon Postgres (multi-tenant + RLS). Numeración secuencial `NNN_descripcion.sql`, aplicada por `web/scripts/apply-migrations.ts` en orden lexicográfico.

## Convenciones

- **Forward**: `NNN_descripcion.sql` — DDL/DML idempotente cuando es posible (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE … ADD COLUMN IF NOT EXISTS`).
- **Rollback**: `NNN_descripcion.rollback.sql` — revierte la forward correspondiente. Obligatorio para nuevas migraciones (ver política).
- Numeración secuencial sin huecos *salvo los ya documentados abajo*.

## Política de rollback

A partir de la migración **025** todas las forwards tienen su `.rollback.sql` pareja. Las migraciones anteriores se gestionan así:

| Rango | Estado | Razón |
|---|---|---|
| `001` – `008` | Sin rollback | Schemas fundacionales (`evolution_provider`, `fiscal_and_orders`, `stripe_events_dedupe`, `rls_policies`, `appointments_handoff`, `payment_methods_faqs`, `tax_system`). Aplicadas antes de instaurar la disciplina (commits `eb5a648` y previos, 2026-04-18). Revertir requiere SQL manual. |
| `009` – `020` | Con rollback | Disciplina iniciada en `009_onboarding_fast_warmup` (commit `eeef694`, 2026-04-18). |
| `021` – `024` | Sin rollback | Lapso del sprint *agente IA*: `agent_rules`, `agent_feedback`, `learned_rules`, `handoff_phone` (hasta commit `8d7db6d`, 2026-04-20). Revertir requiere SQL manual. |
| `025` – presente | Con rollback | Disciplina restaurada en `025_warmup_override` (commit `12792fd`, 2026-04-20). |

**Reglas para nuevas migraciones (≥ 057):**

1. Toda forward `NNN_*.sql` debe ir acompañada de `NNN_*.rollback.sql` en el mismo commit.
2. La rollback debe ser ejecutable independientemente: no asumir estado intermedio.
3. Si una migration es destructiva e irreversible (p.ej. `DROP COLUMN` con datos no recuperables), documentarlo explícitamente en cabecera de la rollback con `-- IRREVERSIBLE: …` y mantener el archivo aunque solo contenga el comentario.
4. No backportar rollbacks a las migraciones legacy listadas arriba sin coordinación: el SQL inverso de schemas fundacionales (RLS, fiscal, stripe events) es no trivial y arriesgado.

## Huecos de numeración documentados

| Hueco | Razón |
|---|---|
| `050` | Número saltado deliberadamente. La secuencia pasa de `049_employees` (commit `698643d`) a `051_modifiers_allergens_library` (commit `32d5759`). No hubo migration `050` — es salto de numeración, no archivo abortado ni reservado. |

## Aplicar migraciones

```bash
cd web
pnpm tsx scripts/apply-migrations.ts          # forward only, todas las pendientes
pnpm tsx scripts/apply-migrations.ts --dry    # plan sin ejecutar
```

Las migraciones se registran en la tabla `_migrations` (idempotente) tras aplicarse.

## Rollback manual

Para revertir una migración con `.rollback.sql`:

```bash
psql "$DATABASE_URL" -f shared/migrations/NNN_descripcion.rollback.sql
```

Para migraciones legacy sin rollback (rangos 001-008 y 021-024), revisar el SQL forward y construir el inverso a mano antes de ejecutar — **no improvisar contra producción**.
