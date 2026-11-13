import { runTopicsPipeline } from "@/server/orchestration/topics-pipeline"

// THIS FILE AND src/workflows/daily-pipeline.workflow.ts ARE THE ONLY FILES
// THAT TOUCH THE VERCEL WORKFLOW SDK.
//
// Detachability: when we move off Vercel, delete this file + the cron
// route that calls `start()` (/api/cron/topics) and replace them with
// whatever scheduler the new host uses (BullMQ job, Trigger.dev task,
// systemd timer hitting an admin endpoint, …). `runTopicsPipeline` and
// everything under src/server/topics/ stay unchanged. The vendor lock
// lives here, in two directives, and nowhere else.
//
// Design: ONE coarse step that calls the engine-agnostic
// `runTopicsPipeline` (spec topics/01 §13). Trade-offs:
//   • Pro — topics_run owns observability portably; one row per run.
//   • Pro — minimum surface area for the vendor SDK.
//   • Con — workflow-level retry of this step would re-enter
//     `runTopicsPipeline`. A still-running row blocks the second entry
//     (it returns `skipped`), and a row left `running` by a crash is
//     marked failed after ORCHESTRATION_CONFIG.topics.staleRunAfterMinutes.
//     The phases are idempotent, so a re-run never duplicates data.
//
// Possible follow-up (not now): fan out one step per org if a single
// org's run gets long enough to need its own retry boundary.

export async function topicsPipelineWorkflow() {
  "use workflow"

  const result = await runTopicsPipelineStep()
  return result
}

async function runTopicsPipelineStep() {
  "use step"
  return await runTopicsPipeline({ trigger: "cron" })
}
