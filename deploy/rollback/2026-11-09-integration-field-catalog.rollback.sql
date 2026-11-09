-- ROLLBACK for 2026-11-09-integration-field-catalog.sql. Run ONLY after the phase-3 code is reverted
-- (the new code needs these tables). Loses nothing that matters: every value here is a copy of
-- infra_integrations.field_values JSON, which was dual-written and is untouched. The one thing that
-- only lives here is each option's status (current/outdated/eol) — note it down first if you want it:
--   SELECT integration_type_id, field_key, value, status FROM infra_integration_field_options WHERE status <> 'current';
-- If the backfill's --technology-type step was run, also run the UPDATE it printed (restores the
-- type's old name and field list).
DROP TABLE IF EXISTS infra_integration_field_values;
DROP TABLE IF EXISTS infra_integration_field_options;
