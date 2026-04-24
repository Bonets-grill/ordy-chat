-- Mig 044 — Carta: control numérico de stock por item.
--
-- Contexto:
--   - Hasta hoy menu_items.available es boolean manual: el dueño marca a mano
--     "agotado" cuando se le acaba algo. Eso obliga a estar atento y se les
--     olvida → bot acepta pedidos imposibles → fricción con el cliente.
--   - Esta migración añade gestión numérica opcional:
--       * stock_qty IS NULL  → comportamiento actual (ilimitado, controla
--         available manual).
--       * stock_qty = N      → unidades restantes. createOrder decrementa por
--         cada pedido. Llega a 0 → available=false automático.
--   - low_stock_threshold gatilla alerta WA al admin cuando el stock baja del
--     umbral configurado. last_low_stock_alert_at sirve de cooldown 1h para
--     no spammear.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS + check constraint creado solo si no
-- existe ya. Multi-tenant: las columnas viven en menu_items que ya tiene
-- tenant_id NOT NULL → no afecta el aislamiento.

ALTER TABLE menu_items
    ADD COLUMN IF NOT EXISTS stock_qty integer;

ALTER TABLE menu_items
    ADD COLUMN IF NOT EXISTS low_stock_threshold integer;

ALTER TABLE menu_items
    ADD COLUMN IF NOT EXISTS last_low_stock_alert_at timestamptz;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'menu_items_stock_qty_nonneg'
    ) THEN
        ALTER TABLE menu_items
            ADD CONSTRAINT menu_items_stock_qty_nonneg
            CHECK (stock_qty IS NULL OR stock_qty >= 0);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'menu_items_low_stock_threshold_nonneg'
    ) THEN
        ALTER TABLE menu_items
            ADD CONSTRAINT menu_items_low_stock_threshold_nonneg
            CHECK (low_stock_threshold IS NULL OR low_stock_threshold >= 0);
    END IF;
END $$;
