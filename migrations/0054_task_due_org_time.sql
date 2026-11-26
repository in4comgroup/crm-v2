-- Task deadlines in the ORG time zone (2026-11-26, src/lib/org-time.ts).
-- Before, the task form sent only a date and the server stored it as 00:00
-- UTC (= 03:00 in Moscow: the task showed «Просрочена» from 03:00). Data fix:
-- every task due EXACTLY at 00:00:00 UTC becomes that calendar day at the
-- org's default due time (org_setting `tasks.defaultDueTime`, else 23:59) in
-- the org time zone (`attention.params.timeZone`: org override → platform →
-- Europe/Vienna, the code default). `task.due_date` is a timestamp WITHOUT
-- time zone that holds UTC. Safe to re-run: a converted deadline is no
-- longer at 00:00 UTC (no org zone is UTC+23:59).

UPDATE "task" t
SET "due_date" = (
  (t."due_date"::date + coalesce(
      (SELECT s."value" #>> '{}' FROM "org_setting" s
        WHERE s."organization_id" = t."organization_id" AND s."key" = 'tasks.defaultDueTime'),
      '23:59')::time)
  AT TIME ZONE coalesce(
    (SELECT s."value" ->> 'timeZone' FROM "org_setting" s
      WHERE s."organization_id" = t."organization_id" AND s."key" = 'attention.params'),
    (SELECT p."value" ->> 'timeZone' FROM "platform_setting" p WHERE p."key" = 'attention.params'),
    'Europe/Vienna')
) AT TIME ZONE 'UTC'
WHERE t."due_date"::time = '00:00:00';
