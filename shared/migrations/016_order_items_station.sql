-- 016_order_items_station.sql
-- Station indica dónde se prepara cada línea del pedido: 'kitchen' (cocina) o
-- 'bar'. El KDS filtra por station para separar el flujo de preparación. La
-- tool crear_pedido puede inyectar station (si el tenant lo tipifica); los
-- pedidos existentes quedan en 'kitchen' por defecto (safe backfill).

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS station TEXT NOT NULL DEFAULT 'kitchen'
    CHECK (station IN ('kitchen', 'bar'));

CREATE INDEX IF NOT EXISTS idx_order_items_station
  ON order_items (tenant_id, station, order_id);

COMMENT ON COLUMN order_items.station IS
  'Estación de preparación del item: kitchen|bar. Filtro principal del KDS.';
