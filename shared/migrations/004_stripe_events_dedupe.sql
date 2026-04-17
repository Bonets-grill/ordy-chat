-- 004_stripe_events_dedupe.sql
-- Idempotencia de webhooks Stripe — si Stripe reintenta (retry exponencial
-- si respondemos ≠2xx en 20s o si el handler tarda), evitamos procesar el
-- mismo event.id dos veces. Stripe event IDs son únicos y estables.

CREATE TABLE IF NOT EXISTS stripe_events (
    event_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stripe_events_processed_at
    ON stripe_events(processed_at DESC);
