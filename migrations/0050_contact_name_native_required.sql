-- «Имя на родном языке» of a contact is required; default = the name
-- (product owner, 2026-11-21). Hand-edited before apply: the backfill below
-- must run before SET NOT NULL, else existing NULL / empty rows fail it.
-- Safe to re-run (the UPDATE touches only blank rows).
UPDATE "contact" SET "name_native" = "name" WHERE "name_native" IS NULL OR btrim("name_native") = '';--> statement-breakpoint
ALTER TABLE "contact" ALTER COLUMN "name_native" SET NOT NULL;
