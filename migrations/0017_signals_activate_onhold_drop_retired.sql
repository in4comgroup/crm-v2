-- Signals registry: every proposed code acts, no retired codes are kept
-- (product owner decision R23, 2026-11-14, docs/specs/topics/02-open-questions.md § F).
--   1. All non-retired codes with stage `onHold` become `active` (35 codes:
--      20 read by the extraction prompt, 15 process codes that act once their
--      process exists). `parked` and `gated` codes are not changed.
--   2. The 11 retired codes are deleted (no history is kept for now), with
--      every row that points to them; the «Successor of retired …» notes go.
--   3. One new registry version (max + 1) with change rows.
-- The change log is written FIRST (it reads the rows before they change).
-- Re-runnable: updates and deletes are guarded, the version is written once
-- (guard on change row 'r23:summary').

-- 0. Registry version (max + 1) and change log — written once ─────────────
DO $$
DECLARE v integer;
DECLARE n_retired integer;
DECLARE activated jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "signal_registry_change" WHERE "id" = 'r23:summary') THEN
    SELECT count(*) INTO n_retired FROM "signal_category" WHERE "retired_at" IS NOT NULL;
    SELECT coalesce(jsonb_agg("code" ORDER BY "code"), '[]'::jsonb) INTO activated FROM "signal_category" WHERE "stage" = 'onHold' AND "retired_at" IS NULL;
    SELECT coalesce(max("version"), 0) + 1 INTO v FROM "signal_taxonomy_version";
    INSERT INTO "signal_taxonomy_version" ("version", "summary") VALUES
      (v, 'Все предложенные коды (onHold) включены; выведенные из обращения коды удалены (R23)');
    INSERT INTO "signal_registry_change" ("id", "version", "entity", "entity_key", "action", "before", "after")
    SELECT 'r23:category:' || "code", v, 'category', "code", 'delete',
           jsonb_build_object('retiredAt', "retired_at", 'successorCode', "successor_code"), NULL
    FROM "signal_category" WHERE "retired_at" IS NOT NULL
    ON CONFLICT DO NOTHING;
    INSERT INTO "signal_registry_change" ("id", "version", "entity", "entity_key", "action", "before", "after") VALUES
      ('r23:summary', v, 'category', '*', 'update', '{"stage":"onHold"}'::jsonb,
       jsonb_build_object('stage', 'active', 'codes', activated, 'retiredDeleted', n_retired))
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
--> statement-breakpoint
-- 1. onHold → active ─────────────────────────────────────────────────────────
UPDATE "signal_category" SET "stage" = 'active', "updated_at" = now()
WHERE "stage" = 'onHold' AND "retired_at" IS NULL;
--> statement-breakpoint

-- 2. Retired codes ───────────────────────────────────────────────────────────
UPDATE "signal_category" SET "note_ru" = regexp_replace("note_ru", ' Successor (area )?of retired [^.]*\.', '', 'g')
WHERE "note_ru" ~ 'Successor (area )?of retired';
--> statement-breakpoint
UPDATE "signal_category" SET "successor_code" = NULL
WHERE "successor_code" IN (SELECT "code" FROM "signal_category" WHERE "retired_at" IS NOT NULL);
--> statement-breakpoint
DELETE FROM "organization_signal_override" WHERE "code" IN (SELECT "code" FROM "signal_category" WHERE "retired_at" IS NOT NULL);
--> statement-breakpoint
DELETE FROM "signal_pack_override" WHERE "code" IN (SELECT "code" FROM "signal_category" WHERE "retired_at" IS NOT NULL);
--> statement-breakpoint
DELETE FROM "signal_stage_rule" WHERE "code" IN (SELECT "code" FROM "signal_category" WHERE "retired_at" IS NOT NULL);
--> statement-breakpoint
DELETE FROM "signal_relation"
WHERE "code_a" IN (SELECT "code" FROM "signal_category" WHERE "retired_at" IS NOT NULL)
   OR "code_b" IN (SELECT "code" FROM "signal_category" WHERE "retired_at" IS NOT NULL);
--> statement-breakpoint
DELETE FROM "signal_instance" WHERE "code" IN (SELECT "code" FROM "signal_category" WHERE "retired_at" IS NOT NULL);
--> statement-breakpoint
UPDATE "signal_category" c SET "closes_codes" = ARRAY(
  SELECT x FROM unnest(c."closes_codes") x
  WHERE x NOT IN (SELECT "code" FROM "signal_category" WHERE "retired_at" IS NOT NULL))
WHERE c."closes_codes" && ARRAY(SELECT "code" FROM "signal_category" WHERE "retired_at" IS NOT NULL);
--> statement-breakpoint
DELETE FROM "signal_category" WHERE "retired_at" IS NOT NULL;
