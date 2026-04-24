-- Rollback mig 040 — POS auto-apertura + reportes WA.

ALTER TABLE shifts
    DROP COLUMN IF EXISTS auto_closed;

ALTER TABLE shifts
    DROP COLUMN IF EXISTS auto_opened;

ALTER TABLE agent_configs
    DROP COLUMN IF EXISTS pos_report_phones;
