-- Mig 041 — POS: propinas por pedido.
--
-- Hasta ahora `orders` no registraba propinas. Mario quiere reportes
-- analíticos del POS que separen propinas por turno y por día (tipo
-- "esta semana ganaste 87€ de propinas en lunes").
--
-- Cambios:
--   - Añadimos `orders.tip_cents integer NOT NULL DEFAULT 0` con CHECK >= 0.
--   - Índice parcial para los reportes que filtran "pedidos con propina":
--     filtra por (tenant_id, paid_at) sólo cuando hay propina y el pedido
--     está cobrado — así el índice es pequeño y las queries de propinas
--     evitan full-scan de la tabla orders (millones de filas en prod).
--
-- Semántica:
--   - tip_cents es ADICIONAL al total_cents (no incluido). Total cobrado real
--     al cliente = total_cents + tip_cents. El reporte de propinas las trata
--     como ingreso aparte (no afecta IVA — propina = donativo voluntario).
--   - tip_cents se rellena cuando el camarero/admin marca el pedido como
--     pagado en el KDS y mete una cantidad >0 en el input "Propina €".
--   - Pedidos pre-mig 041 quedan con 0 — no inventamos propinas históricas.

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS tip_cents integer NOT NULL DEFAULT 0
    CHECK (tip_cents >= 0);

-- Índice parcial: solo pedidos pagados con propina > 0. Tamaño mínimo y
-- los reportes "propinas por día/turno" lo aprovechan.
CREATE INDEX IF NOT EXISTS orders_tenant_paid_tip_idx
    ON orders (tenant_id, paid_at)
    WHERE paid_at IS NOT NULL AND tip_cents > 0;
