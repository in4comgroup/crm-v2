-- Russian production calendar 2026 + 2027 (5-day week) for the topics
-- attention engine (docs/specs/topics/06-attention-engine.md §2, §13).
-- Platform reference data: fixed keys (region, day), ON CONFLICT DO NOTHING.
--
-- Only EXCEPTIONS of the plain Mon–Fri rule are stored (src/lib/topics/
-- attention-calendar.ts): weekday days off (holidays, Labour Code art. 112
-- moves, decree transfers), working weekend days, short pre-holiday days.
-- A year with no rows falls back to plain Mon–Fri.
--
-- Sources (checked 2026-11-14, consultant.ru «Производственный календарь»):
--   2026 — Government Decree No. 1466 of 24.09.2025 «О переносе выходных
--          дней в 2026 году»; 247 working days.
--   2027 — Government Decree No. 1187 of 17.09.2026 «О переносе выходных
--          дней в 2027 году»; 247 working days.
INSERT INTO "work_calendar_day" ("region", "day", "is_working", "is_short", "note") VALUES
  -- 2026: weekday days off
  ('RU', '2026-01-01', false, false, 'Новогодние каникулы'),
  ('RU', '2026-01-02', false, false, 'Новогодние каникулы'),
  ('RU', '2026-01-05', false, false, 'Новогодние каникулы'),
  ('RU', '2026-01-06', false, false, 'Новогодние каникулы'),
  ('RU', '2026-01-07', false, false, 'Рождество Христово'),
  ('RU', '2026-01-08', false, false, 'Новогодние каникулы'),
  ('RU', '2026-01-09', false, false, 'Перенос с субботы 03.01'),
  ('RU', '2026-02-23', false, false, 'День защитника Отечества'),
  ('RU', '2026-03-09', false, false, 'Перенос с воскресенья 08.03 (ст. 112 ТК)'),
  ('RU', '2026-05-01', false, false, 'Праздник Весны и Труда'),
  ('RU', '2026-05-11', false, false, 'Перенос с субботы 09.05 (ст. 112 ТК)'),
  ('RU', '2026-06-12', false, false, 'День России'),
  ('RU', '2026-11-04', false, false, 'День народного единства'),
  ('RU', '2026-12-31', false, false, 'Перенос с воскресенья 04.01'),
  -- 2026: short pre-holiday days
  ('RU', '2026-04-30', true, true, 'Предпраздничный день'),
  ('RU', '2026-05-08', true, true, 'Предпраздничный день'),
  ('RU', '2026-06-11', true, true, 'Предпраздничный день'),
  ('RU', '2026-11-03', true, true, 'Предпраздничный день'),
  -- 2027: weekday days off
  ('RU', '2027-01-01', false, false, 'Новогодние каникулы'),
  ('RU', '2027-01-04', false, false, 'Новогодние каникулы'),
  ('RU', '2027-01-05', false, false, 'Новогодние каникулы'),
  ('RU', '2027-01-06', false, false, 'Новогодние каникулы'),
  ('RU', '2027-01-07', false, false, 'Рождество Христово'),
  ('RU', '2027-01-08', false, false, 'Новогодние каникулы'),
  ('RU', '2027-02-22', false, false, 'Перенос с субботы 20.02'),
  ('RU', '2027-02-23', false, false, 'День защитника Отечества'),
  ('RU', '2027-03-08', false, false, 'Международный женский день'),
  ('RU', '2027-05-03', false, false, 'Перенос с субботы 01.05 (ст. 112 ТК)'),
  ('RU', '2027-05-10', false, false, 'Перенос с воскресенья 09.05 (ст. 112 ТК)'),
  ('RU', '2027-06-14', false, false, 'Перенос с субботы 12.06 (ст. 112 ТК)'),
  ('RU', '2027-11-04', false, false, 'День народного единства'),
  ('RU', '2027-11-05', false, false, 'Перенос с субботы 02.01'),
  ('RU', '2027-12-31', false, false, 'Перенос с воскресенья 03.01'),
  -- 2027: working Saturday (day off moved to Mon 22.02), also short
  ('RU', '2027-02-20', true, true, 'Рабочая суббота, предпраздничный день'),
  -- 2027: short pre-holiday days
  ('RU', '2027-04-30', true, true, 'Предпраздничный день'),
  ('RU', '2027-06-11', true, true, 'Предпраздничный день'),
  ('RU', '2027-11-03', true, true, 'Предпраздничный день')
ON CONFLICT ("region", "day") DO NOTHING;
