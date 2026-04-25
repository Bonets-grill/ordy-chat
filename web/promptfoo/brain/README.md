# Brain evals — Promptfoo suite del agente Ordy Chat

Tests automáticos de regresión para el brain (Claude + 11 tools). Ejecutan
contra el runtime de prod en sandbox (`is_test=true` en DB → no envía WA real,
no factura, KDS marca 🧪 — ver Mig 029).

## Por qué

Sin evals, cualquier edit a `runtime/app/brain.py` o `runtime/app/prompt_wrapper.py`
puede romper en silencio: el bot deja de responder en italiano, sigue pidiendo
cocción a Smash, leaks system_prompt, etc. Estos casos están todos en producción
(Bonets en vivo) — no son hipotéticos.

Per `feedback_promptfoo_mandatory.md`: **proyectos con prompts/agentes deben
tener Promptfoo. Evals regresivos por nicho bloquean merge.**

## Cobertura por área

| Caso | Qué cubre |
|---|---|
| `cases/idiomas.yaml` | Bot responde en lang del cliente (ES/IT/DE/FR/EN) + reconoce mesa via canal |
| `cases/modifier-deps.yaml` | Mig 051 dependsOnOptionId — Smash no pregunta cocción, Medallon sí |
| `cases/tool-routing.yaml` | Reserva/pedido/factura/horarios/cancelación → flujo correcto |
| `cases/allergens.yaml` | Declaración alérgeno → respuesta cauta + deriva a humano si grave |
| `cases/edge-cases.yaml` | Prompt injection, ofensivos, idiomas raros, SQL-like, mensaje vacío |

`defaultTest.assert` aplica a TODOS los cases:
- Respuesta no vacía
- Sin "problemas técnicos" (catch-all del brain)
- Tokens medidos (in/out > 0)

## Ejecutar local

```bash
# 1. Variables de entorno (todas presentes en web/.env.local)
export RUNTIME_URL=https://ordy-chat-runtime-production.up.railway.app
export RUNTIME_INTERNAL_SECRET="<from .env.local>"
export DATABASE_URL="<from .env.local>"  # solo si usas pollDb assertions

# 2. Ejecutar suite completa
cd web && pnpm eval:brain

# 3. Smoke rápido (idiomas + edge-cases solo)
cd web && pnpm eval:brain:smoke

# 4. Ver resultados HTML
cd web && pnpm eval:brain:view
```

## Provider custom

`providers/runtime-brain.js` — POST a `${RUNTIME_URL}/internal/playground/generate`
con sandbox=true. Soporta:

- **Multi-turn**: vars.user puede ser string plano (1 turno) o JSON-string de
  un array de messages para conversaciones largas.
- **Lang + canal + mesa**: vars.client_lang, vars.channel, vars.table_number.
- **Poll DB opcional**: si vars.pollDb está set, el provider espera N ms y
  ejecuta SQL contra Neon — útil para verificar tool-use efectivo (ej.
  `SELECT COUNT(*) FROM orders WHERE table_number='1' AND created_at > NOW() - interval '30 seconds'`).

## Estructura de un case

```yaml
- description: "Mesa 1 pide Dakota Smash — no debe preguntar cocción"
  vars:
    user: "Mesa 1, una Dakota Burger Smash. Confirma."
    client_lang: "es"
    channel: "menu_web"
    table_number: "1"
  assert:
    - type: javascript
      value: |
        const t = output.text.toLowerCase();
        return !/punto de cocci[oó]n|tipo de cocci[oó]n/.test(t);
      metric: no-pregunta-coccion-con-smash
```

## Gate CI (ver `.github/workflows/evals.yml`)

Falla merge si `--pass-threshold 0.8` no se cumple. Triggers:
- PR que toca `runtime/app/brain.py`
- PR que toca `runtime/app/prompt_wrapper.py`
- PR que toca `runtime/app/agents/*`
- PR que toca `runtime/app/menu_search.py`

Manual trigger via `workflow_dispatch` para correr cuando quieras.

## Añadir un nuevo case

1. Identifica un bug que ya pasó (ej. "el bot inventó un alérgeno").
2. Añade un case al YAML correspondiente con el mensaje exacto que falló.
3. Define la assertion (ej. `not-contains "no contiene gluten"`).
4. Corre local: `pnpm eval:brain` — debe pasar (verde).
5. Si rompes prompt en el futuro, este case tirará rojo y bloqueará merge.

## Limitaciones conocidas v1

- **No verifica tool-use** directamente — solo respuesta del bot. Para verificar
  que `crear_pedido` se llamó realmente, usa el `pollDb` opcional del provider
  con `SELECT FROM orders WHERE created_at > NOW() - interval '30s'`.
- **Cuesta tokens reales** — cada run consume ~5-15K input + 100-500 output por
  case, contra Anthropic vía el runtime. ~30 cases ≈ 0.50€ por run.
- **Depende de runtime live** — si Railway está caído los evals fallan. Considera
  spinear runtime local para CI offline (TODO).
- **Bonets-specific en alguno cases** — los modifier-deps usan Bonets por la
  config real. Ampliar a un tenant fixture cuando haya un segundo customer.
