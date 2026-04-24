-- Mig 040 — POS: auto-apertura de turno + reportes automáticos por WhatsApp.
--
-- Contexto (sobre mig 038 + mig 039):
--   - Mig 038 introdujo shifts. Requerir que el tenant abra turno manual ANTES
--     del primer pedido era fricción: muchos días nadie se acuerda y los
--     pedidos quedan huérfanos sin shift_id.
--   - Esta migración soporta "turnos obligatorios pero sin romper servicio":
--     si entra un pedido sin turno abierto, createOrder() auto-abre uno con
--     opening_cash=0 y marca auto_opened=true.
--   - Además, un cron diario 23:55 Europe/Madrid cierra los turnos que
--     quedaron abiertos, marca auto_closed=true (counted_cash NULL → no hay
--     cuadre físico, lo hace el dueño a mano al día siguiente si quiere).
--
-- Además: agent_configs gana un array pos_report_phones para que el tenant
-- configure a qué números WA llegan los reportes. Si vacío, cae a
-- agent_configs.handoff_whatsapp_phone (ya existente) por retro-compat.

ALTER TABLE agent_configs
    ADD COLUMN IF NOT EXISTS pos_report_phones text[] NOT NULL DEFAULT '{}';

ALTER TABLE shifts
    ADD COLUMN IF NOT EXISTS auto_opened boolean NOT NULL DEFAULT false;

ALTER TABLE shifts
    ADD COLUMN IF NOT EXISTS auto_closed boolean NOT NULL DEFAULT false;
