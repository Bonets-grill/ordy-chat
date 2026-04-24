-- Migración 036: expiration al silencio de bot.
--
-- Mario 2026-04-24: "cuando yo escribo es decir cuando tomo control el
-- agente sigue escribiendo". Fix: cuando el admin responde manualmente
-- por WhatsApp (msg.es_propio=true), auto-insertamos pausa de 2h en
-- paused_conversations. El bot vuelve solo al expirar.

ALTER TABLE paused_conversations
  ADD COLUMN IF NOT EXISTS pause_until timestamptz;

-- Para pausas manuales viejas (sin until) seguimos respetándolas como
-- "pausado indefinido" — eso ya lo maneja la lógica de app.
