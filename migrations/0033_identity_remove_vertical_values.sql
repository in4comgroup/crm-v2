-- Identity: remove the vertical-specific values (product owner, 2026-11-15:
-- no old / vertical content). «Отрасль» loses «Алкоголь» (alcohol) and
-- «HoReCa» (horeca); «Роль на рынке» loses `horeca` (code list in
-- src/lib/identity/org-profile.ts). Safe to re-run.

-- Profiles that still point at a removed industry lose the value
-- (the FK is ON DELETE SET NULL; done explicitly for clarity).
UPDATE "org_profile" SET "industry_code" = NULL WHERE "industry_code" IN ('alcohol', 'horeca');--> statement-breakpoint
UPDATE "client_profile" SET "industry_code" = NULL WHERE "industry_code" IN ('alcohol', 'horeca');--> statement-breakpoint
DELETE FROM "industry" WHERE "code" IN ('alcohol', 'horeca');--> statement-breakpoint

-- Market role `horeca` removed from stored role lists.
UPDATE "org_profile" SET "market_roles" = array_remove("market_roles", 'horeca') WHERE 'horeca' = ANY("market_roles");--> statement-breakpoint
UPDATE "client_profile" SET "market_roles" = array_remove("market_roles", 'horeca') WHERE 'horeca' = ANY("market_roles");--> statement-breakpoint

-- Pending web proposals that carry a removed value are dropped from review.
UPDATE "client_profile_proposal" SET "status" = 'superseded'
WHERE "status" = 'pending'
  AND (("field" = 'marketRoles' AND "value"::text LIKE '%"horeca"%')
    OR ("field" = 'industry' AND ("value"::text LIKE '%"alcohol"%' OR "value"::text LIKE '%"horeca"%')));
