-- Migración 043: plano visual de mesas (drag-and-drop tipo TouchBistro/Lightspeed).
--
-- Hasta ahora `restaurant_tables` (mig 035) solo tenía número, zona y capacidad.
-- El dashboard mostraba una lista plana. Mario (2026-04-24): "quiero un plano
-- visual donde el dueño dibuja la disposición real del local arrastrando mesas
-- a su sitio, y cada mesa muestra estado (libre/ocupada/billing) en tiempo real
-- para que el camarero sepa de un vistazo".
--
-- Esta migración añade los campos del plano:
--   - pos_x, pos_y     : coordenadas en píxeles dentro del canvas 2000×1500.
--   - shape            : 'square' | 'round' | 'rect'.
--   - seats            : ya existía (default 4) — sumamos CHECK 1..30.
--   - rotation         : 0..359 grados (visual, en pasos de 90 desde la UI).
--   - area             : etiqueta libre del área ("Terraza", "Salón principal",
--                        "Barra"). Coexiste con `zone` por retrocompat.
--   - width, height    : tamaño visual del rect/circle (px), 40..200.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS + CHECKs vía DO/IF NOT EXISTS (Postgres
-- no acepta IF NOT EXISTS en ADD CONSTRAINT, así que lo simulamos con un guard
-- contra pg_constraint).

ALTER TABLE restaurant_tables
  ADD COLUMN IF NOT EXISTS pos_x integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pos_y integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shape text NOT NULL DEFAULT 'square',
  ADD COLUMN IF NOT EXISTS rotation integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS area text,
  ADD COLUMN IF NOT EXISTS width integer NOT NULL DEFAULT 80,
  ADD COLUMN IF NOT EXISTS height integer NOT NULL DEFAULT 80;

-- Constraints idempotentes — un guard por nombre.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'restaurant_tables_shape_chk') THEN
    ALTER TABLE restaurant_tables
      ADD CONSTRAINT restaurant_tables_shape_chk
      CHECK (shape IN ('square','round','rect'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'restaurant_tables_seats_chk') THEN
    ALTER TABLE restaurant_tables
      ADD CONSTRAINT restaurant_tables_seats_chk
      CHECK (seats >= 1 AND seats <= 30);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'restaurant_tables_rotation_chk') THEN
    ALTER TABLE restaurant_tables
      ADD CONSTRAINT restaurant_tables_rotation_chk
      CHECK (rotation >= 0 AND rotation < 360);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'restaurant_tables_width_chk') THEN
    ALTER TABLE restaurant_tables
      ADD CONSTRAINT restaurant_tables_width_chk
      CHECK (width >= 40 AND width <= 200);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'restaurant_tables_height_chk') THEN
    ALTER TABLE restaurant_tables
      ADD CONSTRAINT restaurant_tables_height_chk
      CHECK (height >= 40 AND height <= 200);
  END IF;
END $$;

COMMENT ON COLUMN restaurant_tables.pos_x IS
  'Coordenada X (px) en el canvas 2000×1500 del plano. 0 hasta no posicionarla.';
COMMENT ON COLUMN restaurant_tables.pos_y IS
  'Coordenada Y (px) en el canvas 2000×1500 del plano.';
COMMENT ON COLUMN restaurant_tables.shape IS
  'Forma visual: square | round | rect. UI dibuja rect/circle SVG.';
COMMENT ON COLUMN restaurant_tables.rotation IS
  'Rotación en grados (0,90,180,270 desde UI; CHECK acepta 0..359).';
COMMENT ON COLUMN restaurant_tables.area IS
  'Área libre del local (Terraza, Salón, Barra). Coexiste con zone por retrocompat.';
COMMENT ON COLUMN restaurant_tables.width IS
  'Ancho visual (px), 40..200.';
COMMENT ON COLUMN restaurant_tables.height IS
  'Alto visual (px), 40..200.';
