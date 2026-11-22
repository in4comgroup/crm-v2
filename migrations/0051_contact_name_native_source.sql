ALTER TABLE "contact" ADD COLUMN "name_native_source" text DEFAULT 'source' NOT NULL;--> statement-breakpoint
-- Hand-added backfill (product owner, 2026-11-22): a native name that differs
-- from the system name is kept as set by a person, so a source never replaces
-- it. Equal names stay `source` (the default copy).
UPDATE "contact" SET "name_native_source" = 'manual' WHERE "name_native" IS NOT NULL AND btrim("name_native") <> '' AND btrim("name_native") <> btrim("name");
