-- Mig 042 rollback — Borra modificadores.
--
-- DROP CASCADE de los grupos arrastra los modifiers (FK ON DELETE CASCADE).
-- order_items.modifiers_json simplemente se quita. Las órdenes pasadas
-- pierden el detalle del modifier pero mantienen unit_price_cents/line_total
-- correctos (el snapshot se calculó al crear el order_item).

ALTER TABLE order_items DROP COLUMN IF EXISTS modifiers_json;
DROP TABLE IF EXISTS menu_item_modifiers CASCADE;
DROP TABLE IF EXISTS menu_item_modifier_groups CASCADE;
