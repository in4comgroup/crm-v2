import { type VercelConfig } from "@vercel/config/v1"

// Vercel project config — replaces the older `vercel.json`.
//
// **Schedule duplication is intentional.** Vercel's `vercel.ts`
// evaluator validates the JSON output before runtime imports resolve —
// referencing `ORCHESTRATION_CONFIG.cron` from the orchestration
// config file produced `schedule: undefined` on deploy and tripped the
// platform's "crons[0] missing required property `schedule`" check.
//
// Source of truth for the cron expression at deploy time: this file.
// Source of truth at runtime: `src/server/orchestration/config.ts`
// (read by the orchestration server functions). **If you change one,
// change the other.** A possible follow-up is lifting both copies into a
// system_settings dictionary so this duplication goes away.
//
// The `/api/cron/daily` route validates `Authorization: Bearer
// $CRON_SECRET` in every environment (unset secret = every call rejected).
// Vercel attaches this header automatically when `CRON_SECRET` is set as a
// project env var.
export const config: VercelConfig = {
  crons: [
    {
      path: "/api/cron/daily",
      schedule: "0 3 * * *", // daily at 03:00 UTC — keep in sync with ORCHESTRATION_CONFIG.cron
    },
    {
      // Topics pipeline (docs/specs/topics/01-specification.md §13).
      // Keep in sync with ORCHESTRATION_CONFIG.topics.cron.
      // TEST DEPLOYMENT (Vercel Hobby, 2026-11-18): once a day at 08:00 UTC
      // (09:00 Europe/Vienna in winter = inside working hours, so Telegram
      // pushes can go). Hobby allows at most one run per day per cron and
      // fires anywhere in the hour. On Pro set it back to hourly "0 * * * *".
      path: "/api/cron/topics",
      schedule: "0 8 * * *",
    },
    {
      // Notification checks for every org (docs/specs/notifications §3.2).
      // Keep in sync with ORCHESTRATION_CONFIG.notifications.cron.
      // TEST DEPLOYMENT (Vercel Hobby, 2026-11-18): once a day at 09:00 UTC
      // (10:00 Europe/Vienna in winter, inside working hours for Telegram
      // copies; one hour after the topics run). On Pro set it back to
      // hourly "15 * * * *".
      path: "/api/cron/notifications",
      schedule: "0 9 * * *",
    },
  ],
}
