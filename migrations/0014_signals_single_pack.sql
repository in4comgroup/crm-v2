-- Signals registry v3: ONE pack. The «Дистрибуция» pack is merged into
-- «Базовый пакет» (product owner decision 2026-11-13, R21 in
-- docs/specs/topics/02-open-questions.md § F). Nothing is retired: the 31
-- distribution signals, its blocks DS1–DS7, 9 deal-risk types, 25 stage-rule
-- templates and its relations move to `base`; the pack override of
-- INVOICE_PAID (closes PAYMENT_PROMISE, R12) becomes the code's own value.
-- Per-org activation of single codes stays (organization_signal_override).
-- Guarded: re-runnable, and a no-op where the pack is already gone.

UPDATE "signal_block" SET "pack_code" = 'base' WHERE "pack_code" = 'distribution';
--> statement-breakpoint
UPDATE "signal_category" SET "pack_code" = 'base' WHERE "pack_code" = 'distribution';
--> statement-breakpoint
UPDATE "signal_attribute" SET "pack_code" = 'base' WHERE "pack_code" = 'distribution';
--> statement-breakpoint
UPDATE "signal_relation" SET "pack_code" = 'base' WHERE "pack_code" = 'distribution';
--> statement-breakpoint
UPDATE "deal_risk_type" SET "pack_code" = 'base' WHERE "pack_code" = 'distribution';
--> statement-breakpoint
UPDATE "signal_stage_rule" SET "pack_code" = 'base' WHERE "pack_code" = 'distribution';
--> statement-breakpoint
-- Fold the distribution overrides into the codes themselves (only
-- closes_codes exists today; other fields are applied too when set).
UPDATE "signal_category" c SET
  "closes_codes" = CASE WHEN o."closes_codes" IS NULL THEN c."closes_codes"
    ELSE ARRAY(SELECT DISTINCT unnest(c."closes_codes" || o."closes_codes") ORDER BY 1) END,
  "weight" = coalesce(o."weight", c."weight"),
  "display_profile" = coalesce(o."display_profile", c."display_profile"),
  "recipient_role" = coalesce(o."recipient_role", c."recipient_role"),
  "stage" = coalesce(o."stage", c."stage")
FROM "signal_pack_override" o
WHERE o."pack_code" = 'distribution' AND o."code" = c."code";
--> statement-breakpoint
DELETE FROM "signal_pack_override" WHERE "pack_code" = 'distribution';
--> statement-breakpoint
-- Orgs that had the distribution pack on keep their signals: base on.
INSERT INTO "organization_signal_pack" ("organization_id", "pack_code", "enabled")
SELECT "organization_id", 'base', true FROM "organization_signal_pack"
WHERE "pack_code" = 'distribution' AND "enabled"
ON CONFLICT ("organization_id", "pack_code") DO UPDATE SET "enabled" = true;
--> statement-breakpoint
DELETE FROM "organization_signal_pack" WHERE "pack_code" = 'distribution';
--> statement-breakpoint
DELETE FROM "signal_pack" WHERE "code" = 'distribution';
--> statement-breakpoint
UPDATE "signal_pack" SET "description_ru" = 'Все коды сигналов: продажи, договоры, счета, обратная связь, встречи, контакты, рынок, команда, аккаунт, конкуренты, поставщики, а также заказы, наличие и образцы, листинг, доставка и возвраты, ЕГАИС и документы, оплата (дистрибуция вина и алкоголя). Включение отдельных кодов — по организации.'
WHERE "code" = 'base';
--> statement-breakpoint
INSERT INTO "signal_taxonomy_version" ("version", "summary") VALUES
  (3, 'Один пакет: «Дистрибуция» объединена с «Базовым пакетом» (31 код, блоки DS1–DS7, 9 рисков, 25 шаблонов правил); INVOICE_PAID закрывает и PAYMENT_PROMISE')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "signal_registry_change" ("id", "version", "entity", "entity_key", "action", "before", "after") VALUES
  ('v3:pack:distribution', 3, 'pack', 'distribution', 'delete', '{"code":"distribution","labelRu":"Дистрибуция (вино и крепкий алкоголь)"}'::jsonb, NULL),
  ('v3:pack_override:distribution:INVOICE_PAID', 3, 'pack_override', 'distribution:INVOICE_PAID', 'delete', '{"closesCodes":["INVOICE_OVERDUE","PAYMENT_PROMISE"]}'::jsonb, NULL),
  ('v3:category:INVOICE_PAID', 3, 'category', 'INVOICE_PAID', 'update', '{"closesCodes":["INVOICE_OVERDUE"]}'::jsonb, '{"closesCodes":["INVOICE_OVERDUE","PAYMENT_PROMISE"]}'::jsonb),
  ('v3:moved-to-base', 3, 'category', '*distribution', 'update', '{"packCode":"distribution"}'::jsonb, '{"packCode":"base","note":"31 codes, blocks DS1–DS7, 9 risk types, 25 stage-rule templates, relations"}'::jsonb)
ON CONFLICT DO NOTHING;
