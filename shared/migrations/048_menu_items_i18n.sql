-- Mig 048 — Traducciones i18n de menu_items.
--
-- Permite que el cliente del web chat / menú público vea productos,
-- descripciones y modificadores en su idioma (EN/FR/IT/DE/PT/CA/EU)
-- mientras el KDS y el sistema interno SIEMPRE muestran ES (canónico).
--
-- Estrategia:
--   - i18n_translations es un JSONB con shape:
--       { "en": { "name": "...", "description": "..." },
--         "fr": { "name": "...", "description": "..." } }
--   - NULL/empty = sin traducciones; el cliente cae a ES.
--   - Las traducciones se generan on-demand via Anthropic y se cachean
--     aquí en DB para no re-llamar al LLM cada vez.
--   - El KDS, brain.py crear_pedido y order_items.name SIEMPRE usan
--     menu_items.name (canónico, ES). i18n es solo display al cliente.

ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS i18n_translations jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Mismo concepto para modificadores: el cliente verá "Extra cheese" en EN
-- pero al crear order_item.modifiers_json se persiste el name canónico ES.
ALTER TABLE menu_item_modifier_groups
  ADD COLUMN IF NOT EXISTS i18n_translations jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE menu_item_modifiers
  ADD COLUMN IF NOT EXISTS i18n_translations jsonb NOT NULL DEFAULT '{}'::jsonb;
