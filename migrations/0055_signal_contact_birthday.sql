-- Contact birthday as a topics PROCESS signal (2026-11-26, tester request
-- «Поднимать карточку со срочностью „Сейчас“ в день рождения контакта»).
-- Platform reference data:
--   1. a generic code CONTACT_BIRTHDAY (base pack, block G «Контакты»,
--      `emitted_by = process` → never in the extraction prompt; stage
--      `active` for every org). Weight 8 = band «very high» = profile P8 =
--      list «Сейчас» (no daily P6 limit). Written by the CRM check
--      `contact_birthday` (src/server/topics/checks/contacts.ts) on the day
--      (org time zone) and cleared the next day;
--   2. one registry version (max + 1) with a change row.
-- Fixed key + ON CONFLICT DO NOTHING: a re-run or an admin-changed row keeps
-- the existing row. The version is written once (guard on the change row id).

INSERT INTO "signal_category" ("code", "pack_code", "block_code", "family", "label_ru", "definition_ru", "boundary_ru", "cues_prompt_ru", "synonyms_ru", "anti_cues_ru", "example_ru", "counter_example_ru", "card_note_ru", "weight", "score_rule", "class", "class_by_relation", "kind", "effort", "carries_amount", "asks_us", "inbound_only", "emitted_by", "stage", "display_profile", "recipient_role", "closes_codes", "date_gate", "relevance_days", "trigger_rule", "note_ru") VALUES
  ('CONTACT_BIRTHDAY', 'base', 'G', 'contact', 'День рождения контакта', 'Сегодня (в часовом поясе организации) день рождения контакта: дата из поля «День рождения» карточки контакта.', 'Только по полю «День рождения» контакта; упоминание праздника в переписке — не этот код.', ARRAY[]::text[], '{}'::jsonb, '[]'::jsonb, '«Иван Петров: день рождения сегодня (26.11); исполняется 45 лет»', '', 'Напомни поздравить контакт с днём рождения сегодня; назови компанию и, если известно, сколько лет исполняется (круглая дата — юбилей). Шаги — позвонить или написать лично, при необходимости отправить подарок или открытку.', 8, 'fixed', 'chance', false, 'event', 'quick', false, false, false, 'process', 'active', NULL, 'account', ARRAY[]::text[], NULL, 1, '{"ru":"Данные — поле «День рождения» контакта (активные контакты). Порог — сегодня в часовом поясе организации совпадают день и месяц (29 февраля в невисокосный год — 28 февраля). Запуск — ежедневно, 07:00. Одна тема на контакт и год; на следующий день условие снимается. - Evidence format: «день рождения сегодня (26.11); исполняется 45 лет».","en":"Data = the contact''s «День рождения» field (active contacts). Threshold = today in the org time zone has the same day and month (29 Feb → 28 Feb in a non-leap year). Run daily, 07:00. One topic per contact and year; the condition clears the next day."}'::jsonb, 'Added 2026-11-26 (tester request): process code of the CRM check contact_birthday; weight 8 → «Сейчас».')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

DO $$
DECLARE v integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "signal_registry_change" WHERE "id" = 'birthday:category:CONTACT_BIRTHDAY') THEN
    SELECT coalesce(max("version"), 0) + 1 INTO v FROM "signal_taxonomy_version";
    INSERT INTO "signal_taxonomy_version" ("version", "summary") VALUES
      (v, 'День рождения контакта: процессный код CONTACT_BIRTHDAY (проверка «День рождения контакта», список «Сейчас»)');
    INSERT INTO "signal_registry_change" ("id", "version", "entity", "entity_key", "action", "before", "after") VALUES
      ('birthday:category:CONTACT_BIRTHDAY', v, 'category', 'CONTACT_BIRTHDAY', 'create', NULL, '{"labelRu":"День рождения контакта","family":"contact","blockCode":"G","weight":8,"class":"chance","stage":"active","emittedBy":"process"}'::jsonb)
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
