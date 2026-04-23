-- shared/migrations/033_reviews_and_socials.sql
-- Post-cuenta flow: el agente agradece la visita y comparte enlace de
-- reseña + redes sociales del tenant. Todos opcionales — si el tenant no
-- los configura, el agente solo agradece sin spamear enlaces.
--
-- Idempotente.

ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS review_google_url TEXT;
ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS review_tripadvisor_url TEXT;
ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS social_instagram_url TEXT;
ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS social_facebook_url TEXT;
ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS social_tiktok_url TEXT;

COMMENT ON COLUMN agent_configs.review_google_url IS
  'Enlace Google Maps/Business profile para pedir reseña tras cobrar.';
COMMENT ON COLUMN agent_configs.review_tripadvisor_url IS
  'Enlace TripAdvisor para pedir reseña tras cobrar.';
COMMENT ON COLUMN agent_configs.social_instagram_url IS
  'URL del perfil Instagram. El agente la comparte tras cobrar.';
COMMENT ON COLUMN agent_configs.social_facebook_url IS
  'URL del perfil Facebook. El agente la comparte tras cobrar.';
COMMENT ON COLUMN agent_configs.social_tiktok_url IS
  'URL del perfil TikTok. El agente la comparte tras cobrar.';
