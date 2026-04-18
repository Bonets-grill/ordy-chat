# Promptfoo evals — merger onboarding-fast

Evals del merger LLM que fusiona 1-3 fuentes scrapeadas (website / google / tripadvisor)
en un `CanonicalBusiness` + lista de conflictos.

## Requisitos

- `ANTHROPIC_API_KEY` en el entorno (o `platform_settings.anthropic_api_key` desbloqueado por super admin).
- `pnpm add -D promptfoo` (no instalado aún en este repo — se añade cuando se active el gate CI en fase 9).

## Ejecutar local

```bash
export ANTHROPIC_API_KEY=sk-ant-...
cd web
pnpm dlx promptfoo@0.96.0 eval -c promptfoo/merger.eval.yaml --pass-threshold 0.9
```

## Estructura

- `merger.eval.yaml` — config principal: provider Anthropic, tests con fixtures.
- `fixtures/*.json` — entrada/salida esperada por caso.
- Cada fixture: `{sources, expected: {canonicos, conflictos}}`.

## Gate CI (fase 9)

Falla merge si `--pass-threshold 0.9` no pasa.

## Limitaciones conocidas

- El merger determinista (fallback) también se testa con vitest puro
  (`tests/unit/onboarding-fast/merger.test.ts`) — Promptfoo solo cubre el
  camino LLM.
- Fixtures actuales: 5. Crecerán a ≥10 cuando lleguen bug reports de prod.
