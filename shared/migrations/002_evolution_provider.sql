-- 002_evolution_provider.sql
-- Amplía el CHECK constraint de provider_credentials para incluir 'evolution'
-- (WhatsApp vía Evolution API self-hosted, auto-provisioning por tenant).

ALTER TABLE provider_credentials
    DROP CONSTRAINT IF EXISTS provider_credentials_provider_check;

ALTER TABLE provider_credentials
    ADD CONSTRAINT provider_credentials_provider_check
    CHECK (provider IN ('whapi', 'meta', 'twilio', 'evolution'));
