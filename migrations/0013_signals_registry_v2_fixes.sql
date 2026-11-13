-- Signals registry v2: fixes of seed rows that failed the registry rules
-- (docs/specs/topics/05-signals-registry.md §3.1 label ≤ 60, §7 rule 5).
-- Platform reference data. Guarded on the old values, so a re-run, or a DB
-- where an admin already changed these rows, is a no-op for that row.

UPDATE "signal_category" SET "kind" = 'event', "emitted_by" = 'parser',
  "note_ru" = coalesce("note_ru", '') || E'\nv2: kind event / emitted_by parser (read from text, kept by the date gate). The process watchdog on the contract end date comes in phase 8 with its own trigger_rule.'
WHERE "code" = 'CONTRACT_FRAME_EXPIRY' AND "kind" = 'watchdog' AND "emitted_by" = 'both';
--> statement-breakpoint
UPDATE "signal_category" SET "emitted_by" = 'process',
  "note_ru" = coalesce("note_ru", '') || E'\nv2: emitted_by process (a trend is computed, never read from text).'
WHERE "code" = 'SIGNAL_CONTACT_QUIET' AND "emitted_by" = 'both';
--> statement-breakpoint
UPDATE "signal_category" SET "label_ru" = 'Запрошены материалы: концепция, макет, презентация'
WHERE "code" = 'SALES_MATERIAL_REQUESTED' AND "label_ru" = 'Запрошены индивидуальные материалы (концепция, макет, презентация)';
--> statement-breakpoint
UPDATE "signal_category" SET "label_ru" = 'Запрошена анкета о соответствии (проверка контрагента)'
WHERE "code" = 'CONTRACT_COMPLIANCE_DECLARATION' AND "label_ru" = 'Запрошена анкета или заверение о соответствии (санкции, проверка контрагента, ESG)';
--> statement-breakpoint
UPDATE "signal_category" SET "label_ru" = 'Запрошены документы (УПД, ТТН, сертификаты, справки А/Б)'
WHERE "code" = 'DOCUMENTS_REQUESTED' AND "label_ru" = 'Запрошены документы (УПД, ТТН, сертификаты, декларации, справки А/Б)';
--> statement-breakpoint
INSERT INTO "signal_taxonomy_version" ("version", "summary") VALUES
  (2, 'Исправления сида: CONTRACT_FRAME_EXPIRY и SIGNAL_CONTACT_QUIET (правило 5), три названия длиннее 60 символов')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "signal_registry_change" ("id", "version", "entity", "entity_key", "action", "before", "after") VALUES
  ('v2:CONTRACT_FRAME_EXPIRY', 2, 'category', 'CONTRACT_FRAME_EXPIRY', 'update', '{"kind":"watchdog","emittedBy":"both"}'::jsonb, '{"kind":"event","emittedBy":"parser"}'::jsonb),
  ('v2:SIGNAL_CONTACT_QUIET', 2, 'category', 'SIGNAL_CONTACT_QUIET', 'update', '{"emittedBy":"both"}'::jsonb, '{"emittedBy":"process"}'::jsonb),
  ('v2:SALES_MATERIAL_REQUESTED', 2, 'category', 'SALES_MATERIAL_REQUESTED', 'update', '{"labelRu":"Запрошены индивидуальные материалы (концепция, макет, презентация)"}'::jsonb, '{"labelRu":"Запрошены материалы: концепция, макет, презентация"}'::jsonb),
  ('v2:CONTRACT_COMPLIANCE_DECLARATION', 2, 'category', 'CONTRACT_COMPLIANCE_DECLARATION', 'update', '{"labelRu":"Запрошена анкета или заверение о соответствии (санкции, проверка контрагента, ESG)"}'::jsonb, '{"labelRu":"Запрошена анкета о соответствии (проверка контрагента)"}'::jsonb),
  ('v2:DOCUMENTS_REQUESTED', 2, 'category', 'DOCUMENTS_REQUESTED', 'update', '{"labelRu":"Запрошены документы (УПД, ТТН, сертификаты, декларации, справки А/Б)"}'::jsonb, '{"labelRu":"Запрошены документы (УПД, ТТН, сертификаты, справки А/Б)"}'::jsonb)
ON CONFLICT DO NOTHING;
