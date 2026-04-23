-- rollback de 031_drinks_greeting_pitch
ALTER TABLE agent_configs
  DROP COLUMN IF EXISTS drinks_greeting_pitch;
