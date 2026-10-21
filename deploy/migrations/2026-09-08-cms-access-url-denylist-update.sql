-- Refine CMS Access's "CMS Login URL" avoidable-values denylist to the org's actual set of
-- predictable/generic admin login paths (replaces the starter list from
-- 2026-09-07-integration-custom-fields.sql). Data-only update, not a schema change — idempotent
-- (always sets the same target list), safe to re-run.

UPDATE infra_integration_types
SET fields = JSON_SET(fields, '$[0].avoidableValues', JSON_ARRAY(
  '/admin', '/login', '/admin/login', '/admin/login.php', '/login.php', '/cms', '/cms/login',
  '/backend', '/dashboard', '/controlpanel', '/cpanel', '/wp-admin', '/wp-login.php',
  '/administrator', '/user/login', '/admin.php'
))
WHERE name = 'CMS Access';
