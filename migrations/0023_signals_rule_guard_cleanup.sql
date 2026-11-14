-- R22 follow-up (2026-11-14): the stage-rule TEMPLATE for LISTING_OPPORTUNITY
-- still carried the vertical guard `clientGuard = "client_type = HoReCa"`
-- (wine / HoReCa pilot assumption). The R22 cleanup (0016) cleaned texts but
-- not the `guards` jsonb. Remove that guard from templates (organization_id
-- IS NULL) only — org copies are tenant data and are fixed in «Сигналы».
-- Re-runnable: the WHERE clause matches nothing after the first run.
UPDATE "signal_stage_rule"
SET "guards" = "guards" - 'clientGuard', "updated_at" = now()
WHERE "organization_id" IS NULL
  AND "guards" ->> 'clientGuard' ILIKE '%horeca%';
