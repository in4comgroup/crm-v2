// Pipeline tuning constants. **Hardcoded for MVP.**
//
// Kept dependency-free (no `server-only`, no DB imports) so `vercel.ts`
// can `import { ORCHESTRATION_CONFIG }` at build time to declare the
// cron schedule alongside the runtime caps.
//
// Possible follow-up: move these to a system_settings
// dictionary or env vars once an admin needs to tune without a deploy.

export const ORCHESTRATION_CONFIG = {
  // Cron schedule expression (UTC). Daily at 03:00 UTC.
  //
  // **Duplicated in `vercel.ts`** because Vercel's vercel.ts evaluator
  // validates the JSON output before runtime imports resolve — pulling
  // this constant into the schedule field produces `undefined` and
  // trips schema validation. Keep both in sync until they move
  // to a system_settings dictionary.
  cron: "0 3 * * *",

  // Per-run caps. Items past the cap stay 'pending' / 'needs upload'
  // and get picked up on the next run. Sized for MVP traffic.
  maxParsePerRun: 200,
  maxUploadPerRun: 500,

  // Cap on how many failure entries are kept inside pipeline_run.errors_json.
  // A catastrophically bad run shouldn't bloat the column — once we exceed
  // this, the per-row counters still tick up but individual messages are
  // dropped (a single "+N more truncated" entry is appended).
  maxErrorsPerRun: 200,

  // ── Hourly topics pipeline (runTopicsPipeline, spec topics/01 §13) ──
  topics: {
    // Cron schedule expression (UTC). Every hour at :00.
    //
    // **Duplicated in `vercel.ts`** (same reason as `cron` above) — if
    // you change one, change the other. A sub-daily Vercel cron needs the
    // Vercel **Pro** plan; on Hobby the deploy rejects an hourly schedule.
    cron: "0 * * * *",

    // Spec §13 "Start history (Q16)" + per-run caps — read by the phases
    // once they are built (plan phase 2+). Unused by the skeleton.
    startHistoryDays: 7,
    maxItemsPerOrgPerRun: 200,
    concurrency: 3,

    // Phase «intake» (sync → parse → upload per org, runbook 07 O1): caps
    // per org per hourly run. Parse costs AI money and time (the whole run
    // is one workflow step), so it is capped lower than the daily run.
    maxParsePerOrgPerRun: 50,
    maxUploadPerOrgPerRun: 200,
    // Missing thread keys filled per org per run (older items; no AI).
    maxThreadKeyBackfillPerOrgPerRun: 500,

    // Cap on failure entries kept in topics_run.errors_json (same idea
    // as `maxErrorsPerRun`; a "+N more truncated" marker follows).
    maxErrorsPerRun: 200,

    // A topics_run row still `running` after this long is treated as a
    // crashed run: marked `failed`, and it no longer blocks a new run.
    staleRunAfterMinutes: 120,
  },
} as const

export type OrchestrationConfig = typeof ORCHESTRATION_CONFIG
