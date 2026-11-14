import "server-only"

import { emailProviderStatus, type EmailProviderStatus } from "@/lib/email"
import type { DeliveryParams } from "@/lib/topics/delivery-params"
import type { RenderedEmail } from "@/lib/topics/delivery-render"
import type { DeliveryKind } from "@/lib/topics/delivery-routing"
import { getOrgSetting, listOrgSettingLog } from "@/server/org-settings"
import { listOrgTopicsModes, type TopicsMode } from "@/server/topics/mode"
import { emailChannel, type EmailSender } from "./channels"
import { appBaseUrl, buildUserEmail, eveningReminders, listsForUser, loadDeliveryContext } from "./run"
import {
  DEFAULT_PREFS,
  listDeliveryLog,
  recordDelivery,
  type DeliveryLogRow,
  type DeliveryPrefs,
} from "./store"

// Platform-admin side of topics delivery (block «Рассылка» on /settings →
// «Темы», plan phase 7): org switch, recipients with their choices, preview
// of the three emails for one member (no sending), the delivery log and the
// test send to the CURRENT admin's own address. The route
// `/api/admin/topics/delivery` checks the platform admin role.

export type DeliveryOrgRow = { organizationId: string; name: string; mode: TopicsMode; emailOn: boolean }

export async function listDeliveryOrgs(): Promise<DeliveryOrgRow[]> {
  const orgs = await listOrgTopicsModes()
  return Promise.all(
    orgs.map(async (o) => ({
      organizationId: o.organizationId,
      name: o.name,
      mode: o.mode,
      emailOn: await getOrgSetting(o.organizationId, "topics.delivery.email"),
    })),
  )
}

export type DeliveryAdminView = {
  organizationId: string
  mode: TopicsMode
  emailOn: boolean
  emailSwitchChange: { at: string; by: string | null } | null
  provider: EmailProviderStatus
  appUrl: string
  params: DeliveryParams & { morningDigestTime: string; weeklyReviewWeekday: number; weeklyReviewTime: string; timeZone: string }
  recipients: {
    userId: string
    name: string
    email: string
    banned: boolean
    prefs: DeliveryPrefs
    /** Topics this user gets today (after routing + P6 daily limit). */
    counts: { now: number; digest: number; week: number }
  }[]
  log: DeliveryLogRow[]
}

export async function getDeliveryAdminView(orgId: string, now: Date = new Date()): Promise<DeliveryAdminView> {
  const [ctx, emailOn, log, [lastSwitch], mode] = await Promise.all([
    loadDeliveryContext(orgId, now),
    getOrgSetting(orgId, "topics.delivery.email"),
    listDeliveryLog(orgId, 100),
    listOrgSettingLog(orgId, "topics.delivery.email", 1),
    getOrgSetting(orgId, "topics.enabled"),
  ])
  return {
    organizationId: orgId,
    mode,
    emailOn,
    emailSwitchChange: lastSwitch ? { at: lastSwitch.changedAt.toISOString(), by: lastSwitch.changedBy ?? null } : null,
    provider: emailProviderStatus(),
    appUrl: appBaseUrl(),
    params: {
      ...ctx.dp,
      morningDigestTime: ctx.ap.morningDigestTime,
      weeklyReviewWeekday: ctx.ap.weeklyReviewWeekday,
      weeklyReviewTime: ctx.ap.weeklyReviewTime,
      timeZone: ctx.ap.timeZone,
    },
    recipients: ctx.members.map((m) => {
      const l = listsForUser(ctx, m.userId)
      return {
        userId: m.userId,
        name: m.name,
        email: m.email,
        banned: m.banned,
        prefs: ctx.prefs.get(m.userId) ?? DEFAULT_PREFS,
        counts: { now: l.now.length, digest: l.digest.length, week: l.week.length },
      }
    }),
    log,
  }
}

export class DeliveryAdminError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message)
    this.name = "DeliveryAdminError"
  }
}

/**
 * Render one email for one member at `now` — exactly what the run would
 * build (routing, daily limit), WITHOUT the schedule, the user's choices or
 * any write. Evening: the topics that would get a reminder now (or got one
 * this evening).
 */
export async function previewDelivery(
  orgId: string,
  userId: string,
  kind: DeliveryKind,
  opts: { now?: Date; test?: boolean } = {},
): Promise<RenderedEmail & { topicIds: string[]; localDay: string }> {
  const now = opts.now ?? new Date()
  const ctx = await loadDeliveryContext(orgId, now)
  const m = ctx.members.find((x) => x.userId === userId)
  if (!m) throw new DeliveryAdminError("Пользователь не участник организации", 404)
  const evening = kind === "evening_reminder" ? await eveningReminders(ctx, false) : null
  const c = buildUserEmail(ctx, m, kind, evening, opts.test)
  return { ...c.rendered, topicIds: c.topicIds, localDay: ctx.localDay }
}

/**
 * «Отправить мне тестовое письмо»: the preview of `kind` for member
 * `userId`, sent to the CURRENT admin's own email (subject «[Тест] …»),
 * logged as kind `test` under the admin's user id. Never sends to the member.
 */
export async function sendTestDelivery(
  orgId: string,
  previewUserId: string,
  kind: DeliveryKind,
  admin: { userId: string; email: string; name: string },
  opts: { sender?: EmailSender; now?: Date } = {},
): Promise<{ status: "sent" | "failed" | "skipped"; reason: string | null; subject: string }> {
  const now = opts.now ?? new Date()
  const r = await previewDelivery(orgId, previewUserId, kind, { now, test: true })
  const channel = emailChannel({ sender: opts.sender })
  const res = await channel.send(
    { userId: admin.userId, name: admin.name, email: admin.email, telegramChatId: null },
    { subject: r.subject, html: r.html, text: r.text },
  )
  const reason = res.status === "failed" ? res.error : res.status === "skipped" ? res.reason : null
  await recordDelivery({
    organizationId: orgId,
    userId: admin.userId,
    channel: "email",
    kind: "test",
    localDate: r.localDay,
    topicIds: r.topicIds,
    status: res.status,
    error: reason,
    subject: r.subject,
  })
  return { status: res.status, reason, subject: r.subject }
}
