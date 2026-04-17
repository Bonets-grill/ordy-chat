#!/usr/bin/env bash
# rotate-evolution-apikey.sh
#
# Rota EVOLUTION_API_KEY en todos los consumidores conocidos tras cambiar la key
# en el servidor Evolution (Railway). Uso:
#
#   ./scripts/rotate-evolution-apikey.sh "<NUEVA_APIKEY>"
#
# Antes de correr esto:
#   1) Cambiar AUTHENTICATION_API_KEY / API_KEY (según env var name que use tu
#      Evolution) en el proyecto Railway donde vive el server Evolution.
#   2) Esperar a que Railway redeployar (Evolution lee la var al arrancar).
#   3) Verificar que responde: curl -H "apikey: NUEVA" https://evolution-api-production-bd81.up.railway.app/
#   4) Entonces correr este script con la NUEVA como argumento.
#
# Consumidores que se actualizan:
#   - Ordy Chat Vercel production (EVOLUTION_API_KEY)
#   - Ordy Chat Railway ordy-chat-runtime (EVOLUTION_API_KEY)
#   - DILO Vercel production (EVOLUTION_API_KEY)   ← si existe el proyecto local
#   - DILO .env.local                               ← si existe
#
# Post-update: redeploy Ordy Chat Vercel + Railway.

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Uso: $0 <NUEVA_APIKEY>"
  exit 1
fi
NEW_KEY="$1"

if [[ -z "$NEW_KEY" ]]; then
  echo "Apikey vacía"; exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

step() { printf "\n\033[1;34m▶ %s\033[0m\n" "$*"; }
ok()   { printf "  \033[32m✓\033[0m %s\n" "$*"; }
warn() { printf "  \033[33m⚠\033[0m %s\n" "$*"; }

# ── 1. Ordy Chat Vercel ───────────────────────────────────────────
step "Ordy Chat · Vercel production"
cd "$ROOT/web"
vercel env rm EVOLUTION_API_KEY production --yes 2>&1 | tail -1 || warn "no existía"
printf "%s" "$NEW_KEY" | vercel env add EVOLUTION_API_KEY production 2>&1 | tail -1
ok "Vercel actualizado"

# ── 2. Ordy Chat Railway runtime ──────────────────────────────────
step "Ordy Chat · Railway ordy-chat-runtime"
cd "$ROOT/runtime"
railway link -p ordy-chat-runtime 2>/dev/null || true
railway variables --set "EVOLUTION_API_KEY=$NEW_KEY" --skip-deploys 2>&1 | tail -1
ok "Railway actualizado"

# ── 3. DILO Vercel (si existe el proyecto local) ─────────────────
DILO_DIR="$HOME/Projects/dilo-app"
if [[ -d "$DILO_DIR" ]]; then
  step "DILO · Vercel production"
  cd "$DILO_DIR"
  vercel env rm EVOLUTION_API_KEY production --yes 2>&1 | tail -1 || warn "no existía"
  printf "%s" "$NEW_KEY" | vercel env add EVOLUTION_API_KEY production 2>&1 | tail -1
  ok "DILO Vercel actualizado"
else
  warn "No hay carpeta $DILO_DIR — salta"
fi

# ── 4. DILO .env.local ────────────────────────────────────────────
DILO_ENV="$HOME/Projects/dilo-app/.env.local"
if [[ -f "$DILO_ENV" ]]; then
  step "DILO · .env.local"
  cp "$DILO_ENV" "$DILO_ENV.bak.$(date +%s)"
  if grep -q "^EVOLUTION_API_KEY=" "$DILO_ENV"; then
    # macOS sed requiere '' después de -i
    sed -i '' "s|^EVOLUTION_API_KEY=.*|EVOLUTION_API_KEY=$NEW_KEY|" "$DILO_ENV"
    ok ".env.local actualizado (backup .bak.$(date +%s))"
  else
    warn "EVOLUTION_API_KEY no presente en .env.local — sin cambios"
  fi
fi

# ── 5. Redeploy Ordy Chat ────────────────────────────────────────
step "Ordy Chat · redeploy"
cd "$ROOT/web"
vercel --prod --yes 2>&1 | tail -3
ok "Vercel redeployed"

cd "$ROOT/runtime"
railway up --ci 2>&1 | tail -3
ok "Railway redeployed"

step "Rotación completa"
echo "Verifica manualmente con:"
echo "  curl -H \"apikey: $NEW_KEY\" https://evolution-api-production-bd81.up.railway.app/"
echo "Y prueba el QR desde el dashboard de Ordy Chat."
