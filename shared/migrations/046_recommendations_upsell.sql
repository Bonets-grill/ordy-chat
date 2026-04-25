-- Mig 046 — Recomendaciones del mesero + config de upselling.
--
-- Añade dos cosas:
--   1. menu_items.is_recommended — flag por item que el tenant marca
--      desde /dashboard/recomendaciones. El bloque <carta> dinámico
--      marca esos items con ⭐ RECOMENDADO para que el bot las priorice.
--   2. agent_configs.upsell_config — JSONB con 3 flags de upselling:
--        - suggest_starter_with_main: si el cliente pide solo principal,
--          sugerir 1 entrante recomendado.
--        - suggest_dessert_at_close: antes de cerrar el pedido, ofrecer
--          1 postre recomendado.
--        - suggest_pairing: ofrecer bebida acorde (maridaje) si hay
--          recomendadas en categoría de bebidas.
--      Cuando is_recommended está vacío, los flags NO disparan nada (el
--      bot no inventa).

ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS is_recommended BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_menu_items_tenant_recommended
  ON menu_items(tenant_id)
  WHERE is_recommended = true;

ALTER TABLE agent_configs
  ADD COLUMN IF NOT EXISTS upsell_config JSONB NOT NULL DEFAULT '{"suggestStarterWithMain":false,"suggestDessertAtClose":false,"suggestPairing":false}'::jsonb;

-- Validación defensiva: upsell_config debe ser un objeto.
ALTER TABLE agent_configs
  DROP CONSTRAINT IF EXISTS chk_upsell_config_object;
ALTER TABLE agent_configs
  ADD CONSTRAINT chk_upsell_config_object
  CHECK (jsonb_typeof(upsell_config) = 'object');
