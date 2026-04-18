-- 008_tax_system.sql
-- Sistema fiscal multi-régimen backward-compatible.
--
-- Estrategia ADD-only (no RENAME): añade columnas nuevas `tax_*` y deja las
-- viejas `vat_*` como DEPRECATED con datos históricos. Callers nuevos escriben
-- tanto `tax_*` como `vat_*` con el mismo valor durante la ventana de
-- transición; leen solo `tax_*`. Ventana de rollback intacta.
--
-- Cuando todos los callers hayan migrado y hayan pasado 2 sprints sin drift,
-- se puede DROP de `vat_*` en migración futura (010 o similar).

-- ── 1. tenants: régimen fiscal configurable ─────────────────
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS tax_region TEXT NOT NULL DEFAULT 'es_peninsula'
    CHECK (tax_region IN (
      'es_peninsula','es_canarias','es_ceuta_melilla',
      'pt','fr','it','de','uk',
      'us','mx','co','ar','cl','pe',
      'other'
    )),
  ADD COLUMN IF NOT EXISTS tax_system TEXT NOT NULL DEFAULT 'IVA'
    CHECK (tax_system IN ('IVA','IGIC','IPSI','VAT','SALES_TAX','GST','NONE','CUSTOM')),
  ADD COLUMN IF NOT EXISTS prices_include_tax BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS tax_rate_standard NUMERIC(5,2) NOT NULL DEFAULT 10.00,
  ADD COLUMN IF NOT EXISTS tax_rate_alcohol  NUMERIC(5,2) NOT NULL DEFAULT 21.00,
  ADD COLUMN IF NOT EXISTS tax_label TEXT NOT NULL DEFAULT 'IVA';

COMMENT ON COLUMN tenants.tax_region IS 'Región fiscal del tenant (dropdown UI). Un script one-shot migra por CP.';
COMMENT ON COLUMN tenants.tax_system IS 'Nombre del sistema: IVA, IGIC, IPSI, VAT, SALES_TAX, GST, NONE, CUSTOM';
COMMENT ON COLUMN tenants.prices_include_tax IS 'true = PVP ya incluye impuesto (España hostelería). false = neto B2B.';
COMMENT ON COLUMN tenants.default_vat_rate IS 'DEPRECATED — sustituido por tax_rate_standard. Se mantiene para no romper callers viejos.';

-- ── 2. order_items: tax_rate (+ tax_label) ──────────────────
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS tax_label TEXT NOT NULL DEFAULT 'IVA';

-- Backfill: los order_items existentes se rellenan desde vat_rate.
UPDATE order_items SET tax_rate = vat_rate WHERE tax_rate IS NULL;

-- Tras backfill, tax_rate NOT NULL con default.
ALTER TABLE order_items ALTER COLUMN tax_rate SET DEFAULT 10.00;
ALTER TABLE order_items ALTER COLUMN tax_rate SET NOT NULL;

COMMENT ON COLUMN order_items.vat_rate IS 'DEPRECATED — usar tax_rate';

-- ── 3. orders: tax_cents ────────────────────────────────────
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS tax_cents INTEGER;

UPDATE orders SET tax_cents = vat_cents WHERE tax_cents IS NULL;

ALTER TABLE orders ALTER COLUMN tax_cents SET DEFAULT 0;
ALTER TABLE orders ALTER COLUMN tax_cents SET NOT NULL;

COMMENT ON COLUMN orders.vat_cents IS 'DEPRECATED — usar tax_cents';

-- ── 4. receipts: estado 'not_applicable' ────────────────────
-- Verifactu solo aplica a tenants con tax_system='IVA'. Los de IGIC/IPSI/otros
-- deben quedar en 'not_applicable' (no 'skipped', que implica toggle off por
-- el tenant).
ALTER TABLE receipts DROP CONSTRAINT IF EXISTS receipts_verifactu_status_check;
ALTER TABLE receipts ADD CONSTRAINT receipts_verifactu_status_check
  CHECK (verifactu_status IN ('skipped','not_applicable','pending','submitted','accepted','rejected','error'));
