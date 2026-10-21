-- Replace the boolean "CI/CD configured" checkbox with a 3-state field that actually distinguishes
-- how deployment works: 'auto' (webhook — pushes deploy automatically), 'manual' (repo connected to
-- the server, but deploying is a person clicking "Deploy now" / running a pull), 'disabled' (no repo
-- connected at all — deployment is FTP file upload, outside git entirely).
ALTER TABLE infra_environments ADD COLUMN cicd_status VARCHAR(20) NULL;

-- Backfill from the old boolean: configured=1 -> 'auto', configured=0 -> 'disabled'. (Per the person
-- who owns this data: every environment previously marked "configured" really did have a webhook, not
-- just a connected repo — so mapping straight to 'auto' rather than the more conservative 'manual' is
-- deliberate, not a guess.)
UPDATE infra_environments SET cicd_status = CASE WHEN cicd_configured = 1 THEN 'auto' ELSE 'disabled' END;

ALTER TABLE infra_environments DROP COLUMN cicd_configured;
