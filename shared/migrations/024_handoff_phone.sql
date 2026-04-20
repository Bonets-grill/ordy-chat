-- shared/migrations/024_handoff_phone.sql
-- Número WhatsApp del humano al que el bot escribe cuando ejecuta
-- solicitar_humano. Si NULL/vacío, no manda WA (solo queda la fila
-- en handoff_requests como antes).

ALTER TABLE agent_configs
  ADD COLUMN IF NOT EXISTS handoff_whatsapp_phone TEXT;

COMMENT ON COLUMN agent_configs.handoff_whatsapp_phone IS
  'Teléfono del humano que recibe los avisos cuando el bot escala a persona.
   Formato: solo dígitos con código país, ej 34604342381. NULL = sin aviso WA.';
