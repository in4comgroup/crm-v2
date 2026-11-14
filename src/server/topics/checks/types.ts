// Server contract of topics plan phase 8 (CRM checks + watchdogs). PURE
// types only. The client-safe part (keys, params, results) is
// src/lib/topics/checks.ts.
//
// Every check = one `CheckEvaluator`: it loads its own data (org-explicit,
// read only — NEVER writes), runs PURE logic and returns a `CheckResult`.
// The store (`store.ts`) writes the result: new process instances + topics,
// `checked_at` refresh, B5 clears. So a preview (dry run) = the same
// evaluator without the store.

import type { WorkCalendar } from "@/lib/topics/attention-calendar"
import type { CheckKey, CheckResult, ChecksParams, OpenProcessInstance } from "@/lib/topics/checks"

export type CheckContext = {
  orgId: string
  now: Date
  params: ChecksParams
  /** Org work calendar (time zone, working days). */
  calendar: WorkCalendar
  /**
   * Process instances of the check's codes for the org: all not cleared, plus
   * cleared / older ones created in the last 400 days (cooldowns, «one per
   * client and last order»). Newest first.
   */
  existing: OpenProcessInstance[]
}

export type CheckEvaluator = (ctx: CheckContext) => Promise<CheckResult>

export type CheckEvaluators = Partial<Record<CheckKey, CheckEvaluator>>
