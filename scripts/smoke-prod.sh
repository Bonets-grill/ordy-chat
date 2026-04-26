#!/usr/bin/env bash
# scripts/smoke-prod.sh — smoke test read-only de prod ordy-chat.
#
# Uso: ./scripts/smoke-prod.sh
#
# Verifica que los endpoints críticos de Vercel + Railway responden con el
# código HTTP esperado. NO toca DB, NO autentica, NO escribe nada. Apto para:
#   - Cron post-deploy (GitHub Actions / Better Stack heartbeat).
#   - Verificación manual tras un push.
#
# Salida: 0 si todo verde, 1 si algo falla. Imprime tabla con resultados.

set -uo pipefail

WEB="https://ordychat.ordysuite.com"
RUNTIME="https://ordy-chat-runtime-production.up.railway.app"
EVOLUTION="https://evolution-api-production-bb66.up.railway.app"

declare -a RESULTS=()
FAILED=0

# check <name> <expected_code_or_codes> <url> [extra-curl-args]
# expected puede ser "200" o "200|302|307" para múltiples válidos.
check() {
  local name="$1" expected="$2" url="$3"; shift 3
  local actual
  actual=$(curl -s -o /dev/null -w "%{http_code}" -m 10 "$@" "$url" 2>/dev/null || echo "000")
  if [[ "|$expected|" == *"|$actual|"* ]]; then
    RESULTS+=("✓|$name|$actual|$url")
  else
    RESULTS+=("✗|$name|$actual (esperado $expected)|$url")
    FAILED=$((FAILED + 1))
  fi
}

echo "→ Smoke test ordy-chat prod ($(date -u +%FT%TZ))"
echo

# 1. Health endpoints — los más críticos
check "web /api/health"        "200"     "$WEB/api/health"
check "runtime /health"        "200"     "$RUNTIME/health"
check "runtime /"              "200"     "$RUNTIME/"
check "evolution /"            "200"     "$EVOLUTION"

# 2. Landing pública
check "landing /"              "200"     "$WEB/"
check "pricing"                "200"     "$WEB/pricing"
check "terms"                  "200"     "$WEB/terms"
check "privacy"                "200"     "$WEB/privacy"

# 3. Auth flow (sin login → 307/302 hacia /signin)
check "signin page"            "200"     "$WEB/signin"
check "dashboard sin auth"     "307|302" "$WEB/dashboard"
check "ajustes sin auth"       "307|302" "$WEB/dashboard/ajustes"

# 4. Webhook security (sin firma → rechazo)
check "stripe webhook bouncer" "400|401|405" "$WEB/api/stripe/webhook" -X POST -H "Content-Type: application/json" -d '{}'
# WhatsApp webhooks viven en runtime Railway, no en web Vercel — saltado.

# 5. Cron security (sin secret → 401)
check "cron sessions-cleanup"  "401|403"     "$WEB/api/cron/sessions-cleanup"
check "cron auto-open-shifts"  "401|403"     "$WEB/api/cron/auto-open-shifts"
check "cron daily-sales"       "401|403"     "$WEB/api/cron/daily-sales-report"

# 6. PWA assets
check "manifest.webmanifest"   "200"     "$WEB/manifest.webmanifest"
check "icon-192"               "200"     "$WEB/icon-192.png"
check "icon-512"               "200"     "$WEB/icon-512.png"

# 7. DB latency en /api/health (extra check de profundidad)
DB_LATENCY=$(curl -s -m 10 "$WEB/api/health" 2>/dev/null | grep -oE '"latency_ms":[0-9]+' | cut -d: -f2)
if [[ -n "$DB_LATENCY" ]] && [[ "$DB_LATENCY" -lt 1000 ]]; then
  RESULTS+=("✓|db latency|${DB_LATENCY}ms|< 1000ms")
else
  RESULTS+=("✗|db latency|${DB_LATENCY:-N/A}|esperado < 1000ms")
  FAILED=$((FAILED + 1))
fi

# 7b. Brain conversacional real (sandbox, ejerce LLM end-to-end).
#
# Detecta brain_empty_text y otros fallos de UX que los healthchecks NO ven.
# Solo se ejecuta si RUNTIME_INTERNAL_SECRET está exportado (apto para cron
# post-deploy con la secret en el entorno; en local sin secret se omite con
# un aviso visible para que nadie crea que está cubierto cuando no lo está).
if [[ -n "${RUNTIME_INTERNAL_SECRET:-}" ]]; then
  # Helper: prueba 1 turno en un idioma y verifica que la respuesta no esté
  # vacía, no contenga "problemas técnicos", y (si aplica) contenga al menos
  # un marcador del idioma esperado para detectar regresiones del dual-lang.
  brain_check() {
    local label="$1" lang="$2" msg="$3" markers="$4"
    local body resp txt len
    body=$(printf '{"tenant_slug":"bonets-grill-icod","client_lang":"%s","messages":[{"role":"user","content":"%s"}]}' "$lang" "$msg")
    resp=$(curl -s -m 30 -X POST "$RUNTIME/internal/playground/generate" \
      -H "Content-Type: application/json" \
      -H "X-Internal-Secret: $RUNTIME_INTERNAL_SECRET" \
      -d "$body" 2>/dev/null)
    txt=$(echo "$resp" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("response",""))' 2>/dev/null)
    len=${#txt}
    if [[ "$len" -lt 5 ]] || [[ "$txt" == *"problemas técnicos"* ]]; then
      RESULTS+=("✗|brain $label|${len}c|respuesta vacía o fallback técnico")
      FAILED=$((FAILED + 1))
      return
    fi
    if [[ -n "$markers" ]]; then
      # bash 3.2-compatible lowercase (macOS default sin ${var,,}).
      local txt_lc markers_lc found=0 m
      txt_lc=$(printf '%s' "$txt" | tr '[:upper:]' '[:lower:]')
      markers_lc=$(printf '%s' "$markers" | tr '[:upper:]' '[:lower:]')
      IFS='|' read -ra arr <<< "$markers_lc"
      for m in "${arr[@]}"; do
        if [[ "$txt_lc" == *"$m"* ]]; then found=1; break; fi
      done
      if [[ $found -eq 0 ]]; then
        RESULTS+=("✗|brain $label|${len}c|sin marcador idioma (esperado: $markers)")
        FAILED=$((FAILED + 1))
        return
      fi
    fi
    RESULTS+=("✓|brain $label|${len}c|respuesta OK con idioma correcto")
  }
  brain_check "es"            "es" "hola"                          ""
  brain_check "en (dual-lang)" "en" "hi, I want to order a burger" "you|order|burger|hello|hi"
  brain_check "de (dual-lang)" "de" "hallo, ich möchte bestellen"  "möcht|hallo|bestell|guten|sie"
else
  RESULTS+=("⚠|brain conversacional|skipped|exporta RUNTIME_INTERNAL_SECRET para cubrir brain")
fi

# 8. Commit en prod (si /api/health responde con commit)
WEB_COMMIT=$(curl -s -m 10 "$WEB/api/health" 2>/dev/null | grep -oE '"commit":"[a-f0-9]+"' | cut -d'"' -f4)
RUNTIME_COMMIT=$(curl -s -m 10 "$RUNTIME/version" 2>/dev/null | grep -oE '"commit":"[a-f0-9]+"' | cut -d'"' -f4)
if [[ "$WEB_COMMIT" == "$RUNTIME_COMMIT" ]] && [[ -n "$WEB_COMMIT" ]]; then
  RESULTS+=("✓|web/runtime sync|${WEB_COMMIT}|same commit deployed")
else
  RESULTS+=("⚠|web/runtime sync|web=$WEB_COMMIT runtime=$RUNTIME_COMMIT|distinto deploy (drift OK si Railway aún en cola)")
fi

# Print tabla
printf "%-3s %-32s %-16s %s\n" "ST" "CHECK" "STATUS" "DETAIL"
printf "%-3s %-32s %-16s %s\n" "──" "──────────────────────" "──────" "──────"
for row in "${RESULTS[@]}"; do
  IFS='|' read -r status name code detail <<< "$row"
  printf "%-3s %-32s %-16s %s\n" "$status" "$name" "$code" "$detail"
done

echo
if [[ $FAILED -eq 0 ]]; then
  echo "✓ Smoke verde — $((${#RESULTS[@]})) checks pasaron."
  exit 0
else
  echo "✗ Smoke ROJO — $FAILED de ${#RESULTS[@]} checks fallaron."
  exit 1
fi
