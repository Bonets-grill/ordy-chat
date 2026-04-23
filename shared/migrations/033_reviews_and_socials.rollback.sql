-- rollback 033_reviews_and_socials
ALTER TABLE agent_configs DROP COLUMN IF EXISTS review_google_url;
ALTER TABLE agent_configs DROP COLUMN IF EXISTS review_tripadvisor_url;
ALTER TABLE agent_configs DROP COLUMN IF EXISTS social_instagram_url;
ALTER TABLE agent_configs DROP COLUMN IF EXISTS social_facebook_url;
ALTER TABLE agent_configs DROP COLUMN IF EXISTS social_tiktok_url;
