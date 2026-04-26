-- Rollback Migration 057 — quita encuesta NPS post-pedido.
-- Orden inverso al forward: trigger → función → índices → tabla.

DROP TRIGGER IF EXISTS post_order_survey_enqueue_trigger ON orders;
DROP FUNCTION IF EXISTS enqueue_post_order_survey();
DROP INDEX IF EXISTS post_order_surveys_phone_recent_idx;
DROP INDEX IF EXISTS post_order_surveys_dispatch_idx;
DROP TABLE IF EXISTS post_order_surveys;
