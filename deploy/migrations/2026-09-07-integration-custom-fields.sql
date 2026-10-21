-- Generic custom-fields mechanism for Integration Types (behavior = 'custom_fields'), so a type like
-- "CMS Access" can define its own fields (e.g. Login URL, Login Name), each with two optional
-- warn-only validation lists: `possibleValues` (suggested/approved answers — flagged if the entered
-- value matches none) and `avoidableValues` (known-bad patterns — flagged if the entered value
-- contains one). Never used to store passwords/secrets — enforced in the API, not just here.
-- The seed insert below is idempotent (unique-name-guarded), safe to re-run. The two ALTER TABLEs are
-- NOT (plain MySQL — unlike MariaDB — has no `ADD COLUMN IF NOT EXISTS`); run this file once per
-- environment, or drop the two ALTERs on a repeat run if the columns already exist.

ALTER TABLE infra_integration_types ADD COLUMN fields JSON NULL AFTER behavior;
ALTER TABLE infra_integrations ADD COLUMN field_values JSON NULL AFTER value;

-- Seed "CMS Access" (relies on infra_integration_types.name being UNIQUE — no-op if it already exists).
-- `login_name`'s possibleValues is left empty: fill in the org's actual approved login name(s) via
-- the Integration Types screen — there is no safe default to guess.
INSERT IGNORE INTO infra_integration_types (created_at, updated_at, name, behavior, is_active, fields)
VALUES (
  NOW(6), NOW(6), 'CMS Access', 'custom_fields', 1,
  JSON_ARRAY(
    JSON_OBJECT(
      'key', 'login_url',
      'label', 'CMS Login URL',
      'possibleValues', JSON_ARRAY(),
      'avoidableValues', JSON_ARRAY(
        'wp-admin', 'wp-login.php', '/admin', '/administrator', '/login', '/signin',
        '/user/login', '/cms', '/backend', '/manage', '/management', '/control',
        '/controlpanel', '/panel', '/portal', '/dashboard', '/console', '/moderator'
      )
    ),
    JSON_OBJECT(
      'key', 'login_name',
      'label', 'CMS Login Name',
      'possibleValues', JSON_ARRAY(),
      'avoidableValues', JSON_ARRAY()
    )
  )
);
