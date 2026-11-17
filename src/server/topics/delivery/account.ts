import "server-only"

import { loadAttentionParams } from "@/server/topics/attention/store"
import { getOrgSetting } from "@/server/org-settings"
import { getMyTelegramView } from "@/server/telegram/account"
import { getTopicsMode } from "@/server/topics/mode"
import {
  getUserDeliveryPrefs,
  loadDeliveryParams,
  orgEmailDeliveryOn,
  setUserDeliveryPrefs,
  type DeliveryPrefsPatch,
} from "./store"

// The user's own delivery settings on /account («Уведомления по темам»,
// plan phase 7). Org-explicit; the route `/api/account/topic-delivery`
// checks the session and the membership of the active org.

export type AccountDeliveryView = {
  /** Topics mode `on`: the section is shown. */
  visible: boolean
  /** Org switch `topics.delivery.email` (platform admin): emails are really sent. */
  orgEmailOn: boolean
  prefs: { emailMorning: boolean; emailWeekly: boolean; emailEvening: boolean }
  /** Topic pushes in Telegram (topics/08 T2): `bound` = the member linked Telegram (/profile); `orgOn` = org switch. */
  telegram: { available: boolean; bound: boolean; orgOn: boolean; enabled: boolean }
  schedule: { morning: string; weeklyWeekday: number; weekly: string; evening: string; timeZone: string }
}

export async function getAccountDeliveryView(orgId: string, userId: string): Promise<AccountDeliveryView> {
  const [mode, orgEmailOn, prefs, ap, dp, tg, tgOrgOn] = await Promise.all([
    getTopicsMode(orgId),
    orgEmailDeliveryOn(orgId),
    getUserDeliveryPrefs(orgId, userId),
    loadAttentionParams(orgId),
    loadDeliveryParams(orgId),
    getMyTelegramView(orgId, userId),
    getOrgSetting(orgId, "topics.delivery.telegram"),
  ])
  return {
    visible: mode === "on",
    orgEmailOn,
    prefs: { emailMorning: prefs.emailMorning, emailWeekly: prefs.emailWeekly, emailEvening: prefs.emailEvening },
    telegram: { available: tg.available, bound: tg.binding?.status === "active", orgOn: tgOrgOn, enabled: prefs.telegramEnabled },
    schedule: {
      morning: ap.morningDigestTime,
      weeklyWeekday: ap.weeklyReviewWeekday,
      weekly: ap.weeklyReviewTime,
      evening: dp.eveningDigestTime,
      timeZone: ap.timeZone,
    },
  }
}

export async function saveAccountDeliveryPrefs(orgId: string, userId: string, patch: DeliveryPrefsPatch): Promise<AccountDeliveryView> {
  await setUserDeliveryPrefs(orgId, userId, patch)
  return getAccountDeliveryView(orgId, userId)
}
