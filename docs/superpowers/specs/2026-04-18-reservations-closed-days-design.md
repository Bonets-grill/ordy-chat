# Closed Days — Reservas cerradas por fecha (tenant)

**Fecha:** 2026-04-18
**Scope:** dar al tenant un control simple para marcar fechas en las que su agente NO acepta reservas nuevas (restaurante lleno, vacaciones, evento privado, etc.) sin editar knowledge manualmente.

---

## §1 Motivación

Hoy (18 abril 2026) vimos que Bonets Grill se llenó de reservas para el día y no teníamos un mecanismo rápido para decirle al agente "hoy no aceptes más". La solución temporal fue inyectar un item de knowledge con la regla del día — funciona pero:

- Depende del tenant acordarse de borrarlo al día siguiente
- Requiere editar texto con formato específico
- No es testeable
- No escala cuando hay varios días cerrados (puente, vacaciones)

Meta:

- Tenant marca fechas cerradas desde `/agent/closed-days` con un calendar picker.
- El agente ve esas fechas como reglas de contexto inyectadas en el system prompt.
- La tool `agendar_cita` rechaza internamente fechas cerradas (double guard runtime).
- Cada día a las 04:00 Madrid un cron limpia fechas ya pasadas (housekeeping).

Fuera de scope:
- Horarios parciales cerrados (ej: "cerrado de 14-16h hoy") → v2.
- Motivo por día ("evento privado") → v2.
- Integración con reservas reales en Google Calendar → ya hay tool separada.

---

## §2 Stack

Sin cambios. Next.js 16 App Router, Drizzle, Neon, FastAPI runtime, shadcn.

Sí: añado un componente client calendar picker inline (sin dep nueva — HTML `<input type="date">` basta para v1).

---

## §3 DB — migración 013

**⚠️ La migración 012 está reservada por el reseller-panel. Esta feature usa 013.**
**⚠️ No tocar hasta que el reseller-panel haga merge.**

```sql
-- shared/migrations/013_reservations_closed_days.sql
BEGIN;

ALTER TABLE agent_configs
  ADD COLUMN IF NOT EXISTS reservations_closed_for DATE[] NOT NULL DEFAULT ARRAY[]::DATE[];

CREATE INDEX IF NOT EXISTS idx_agent_configs_closed_for_gin
  ON agent_configs USING GIN (reservations_closed_for);

COMMIT;
```

Rollback:
```sql
BEGIN;
DROP INDEX IF EXISTS idx_agent_configs_closed_for_gin;
ALTER TABLE agent_configs DROP COLUMN IF EXISTS reservations_closed_for;
COMMIT;
```

Drizzle schema (después del merge del reseller-panel):

```ts
// web/lib/db/schema.ts — añadir a agentConfigs
reservationsClosedFor: date("reservations_closed_for").array().notNull().default(sql`ARRAY[]::date[]`),
```

---

## §4 UI — /agent/closed-days

Ruta: `web/app/agent/closed-days/page.tsx` (server component + client calendar).

Shape:
- Server: lee `agent_configs.reservations_closed_for` del tenant actual.
- Client `<ClosedDaysCalendar>`: HTML date input + lista visible de fechas añadidas, botón × para borrar cada una, botón "+ Añadir día".
- Server action `setClosedDaysAction(dates: string[])`:
  - `requireTenant()` primera línea
  - Zod `z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(60)`
  - Filtrar fechas pasadas (past < today-Madrid)
  - UPDATE `agent_configs SET reservations_closed_for = $1`
  - audit_log action=`agent_set_closed_days`
  - revalidatePath('/agent', '/agent/closed-days')

UX: muestra claramente "HOY está cerrado" con badge rojo si `CURRENT_DATE IN reservations_closed_for`.

---

## §5 Inyección en el prompt del agente

`runtime/app/brain.py` al construir el system_prompt:

```python
# Después de inyectar knowledge, añade una sección de reglas operativas si aplica.
closed = tenant.config.get("reservations_closed_for") or []
today = datetime.now(ZoneInfo("Europe/Madrid")).date().isoformat()
if today in closed:
    prompt += f"\n\n## REGLA: Hoy {today} el restaurante NO acepta reservas nuevas. Si piden mesa para hoy, discúlpate y ofrece otro día."
```

Además, si piden para una fecha que está en `closed`:

```python
closed_future = [d for d in closed if d > today]
if closed_future:
    prompt += f"\n\n## Fechas sin reservas: {', '.join(closed_future)}. Si piden reservar en estas fechas, ofrece otro día."
```

---

## §6 Double-guard en tool `agendar_cita`

`runtime/app/tools/agendar_cita.py` (ya existe):

```python
# Al inicio, antes de confirmar el slot:
requested_date = parse_fecha(args["fecha"]).date().isoformat()
if requested_date in (tenant.config.get("reservations_closed_for") or []):
    return {
      "ok": False,
      "error": "fecha_cerrada",
      "mensaje_para_cliente": (
        f"Ese día ({requested_date}) no tomamos reservas. ¿Otra fecha?"
      )
    }
```

Defensa en profundidad: aunque el agente intente ignorar la regla del prompt, la tool rechaza.

---

## §7 Cron housekeeping

`web/app/api/cron/closed-days-cleanup/route.ts` cada día 04:00 Madrid (entrada en `vercel.json`):

```sql
UPDATE agent_configs
SET reservations_closed_for = ARRAY(
  SELECT unnest(reservations_closed_for)
  WHERE unnest >= CURRENT_DATE
),
updated_at = now()
WHERE cardinality(reservations_closed_for) > 0;
```

Output: log de cuántas fechas purgadas y por cuántos tenants.

---

## §8 Fases (6 fases)

1. **F1** Migración 013 + schema.ts + rollback.
2. **F2** Server action `setClosedDaysAction` + `getClosedDays()` helper + tests unit.
3. **F3** `/agent/closed-days/page.tsx` + `ClosedDaysCalendar.tsx` client + link desde `/agent`.
4. **F4** Runtime `brain.py` inyección de regla (+ tests pytest del prompt builder).
5. **F5** Runtime `agendar_cita` guard + test.
6. **F6** Cron cleanup + E2E smoke (setClosedDays → mensaje WhatsApp → rechazo) + deploy.

Total estimado: 2-3h.

---

## §9 Riesgos

| Riesgo | Mitigación |
|---|---|
| Tenant olvida borrar fecha pasada | Cron housekeeping diario 04:00. |
| Race: tenant añade fecha, cliente ya envió mensaje WhatsApp antes | Ambos guards (prompt + tool) protegen: el segundo mensaje del cliente ya ve la regla. |
| Timezone del tenant distinto a Madrid | Usa `agent_configs.schedule` hint o columna `tz` futura. v1 asume Madrid. |
| Array vs tabla separada | `DATE[]` suficiente hasta 365 fechas/tenant. Si llega a 1000+ (improbable) migrar a tabla. |
| Merge conflict con reseller-panel | Esperar a que reseller-panel haga merge antes de ejecutar F1. |

---

## §10 Compromiso

No ejecutar F1 hasta que `feat/reseller-panel` esté en `main`. Después: the-architect → blueprint → audit-architect (5 auditores) → fases → push.
