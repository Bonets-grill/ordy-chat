-- Migración 034: añade image_url a menu_items.
--
-- Motivo: el scraper de URL (codemida.com, webs de restaurantes, etc.)
-- encuentra imágenes por item en el HTML pero el schema actual las
-- descartaba. Mario (Bonets Grill): "no extrajo las imagenes y eso es
-- de suma importancia".
--
-- Nullable porque ítems manuales pueden no tener imagen, y los ítems
-- antiguos scrapeados siguen sin ella hasta que se re-importe la carta.

ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS image_url text;
