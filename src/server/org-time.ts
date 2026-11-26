import "server-only"

// The org's time context for task deadlines (src/lib/org-time.ts): time zone
// from «Рабочий контекст» (`attention.params`) + `tasks.defaultDueTime`.
// Both reads are cached for 60 s by their settings layers.

import { ORG_TIME_FALLBACK, type OrgTime } from "@/lib/org-time"
import { getOrgSetting } from "@/server/org-settings"
import { loadAttentionParams } from "@/server/topics/attention/store"

export async function loadOrgTime(orgId: string): Promise<OrgTime> {
  const [timeZone, defaultDueTime] = await Promise.all([
    loadAttentionParams(orgId)
      .then((p) => p.timeZone)
      .catch(() => ORG_TIME_FALLBACK.timeZone),
    getOrgSetting(orgId, "tasks.defaultDueTime").catch(() => null),
  ])
  return { timeZone, defaultDueTime: defaultDueTime ?? ORG_TIME_FALLBACK.defaultDueTime }
}
