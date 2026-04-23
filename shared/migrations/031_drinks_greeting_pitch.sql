-- shared/migrations/031_drinks_greeting_pitch.sql
-- Texto libre que el tenant escribe en /dashboard/carta para que el bot
-- use LITERALMENTE en el flujo "bebidas primero" del QR de mesa.
--
-- Ejemplo: "Tenemos caña La Tropical, tinto de verano, mojito y agua con
--           gas". El bot no inventa ni improvisa — ofrece esas bebidas.
--
-- Si NULL o vacío, el bot pregunta "¿qué os apetece beber?" de forma
-- abierta y toma la respuesta del cliente tal cual.
--
-- Idempotente.

ALTER TABLE agent_configs
  ADD COLUMN IF NOT EXISTS drinks_greeting_pitch TEXT;

COMMENT ON COLUMN agent_configs.drinks_greeting_pitch IS
  'Texto que el tenant edita para que el bot ofrezca bebidas curadas en el primer turno del QR de mesa. NULL/vacío → pregunta abierta.';
