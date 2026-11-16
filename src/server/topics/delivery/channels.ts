import "server-only"

import { emailProviderStatus, sendEmails, type EmailProviderStatus } from "@/lib/email"
import type { DeliveryChannelKey } from "./store"

// Delivery channels of topics delivery (plan phase 7). One interface, so a
// new channel plugs into the run without touching the content or the
// schedule:
//   email    — built: platform system mail through `sendEmails`
//              (src/lib/email.ts, Nylas). A topics digest is system
//              mail from the platform, never mail from an org mailbox.
//   telegram — STUB (open part of phase 7): always `skipped: "telegram not
//              configured"`. The real channel will send through the org's
//              Telegram bot to `topic_delivery_pref.telegram_chat_id` (bind
//              flow via the bot), at most `telegramMaxPerCard7d` pushes per
//              card in 7 days (kind `push`, counted from `topic_delivery`).

export type DeliveryMessage = { subject: string; html: string; text: string }

export type ChannelRecipient = {
  userId: string
  name: string
  email: string
  telegramChatId: string | null
}

export type ChannelSendResult =
  | { status: "sent" }
  | { status: "failed"; error: string }
  | { status: "skipped"; reason: string }

export interface DeliveryChannel {
  readonly key: DeliveryChannelKey
  /** Can this channel send at all in this environment? (never throws) */
  available(): { ok: true } | { ok: false; reason: string }
  /** The recipient's address on this channel, or null (nothing to send to). */
  address(r: ChannelRecipient): string | null
  /** Send one message. Never throws: errors come back as `failed`. */
  send(r: ChannelRecipient, msg: DeliveryMessage): Promise<ChannelSendResult>
}

/** The email send function (`sendEmails` by default; tests inject a fake). */
export type EmailSender = (v: { to: string; subject: string; body: string; text?: string }) => Promise<unknown>

export function emailChannel(
  opts: { sender?: EmailSender; providerStatus?: () => EmailProviderStatus; toOverride?: string } = {},
): DeliveryChannel {
  const sender = opts.sender ?? sendEmails
  const status = opts.providerStatus ?? emailProviderStatus
  const available = (): { ok: true } | { ok: false; reason: string } => {
    const s = status()
    return s.configured ? { ok: true } : { ok: false, reason: `email provider not configured: ${s.reason}` }
  }
  const address = (r: ChannelRecipient): string | null => {
    const to = (opts.toOverride ?? r.email ?? "").trim()
    return /^[^@\s]+@[^@\s]+$/.test(to) ? to : null
  }
  return {
    key: "email",
    available,
    address,
    async send(r, msg) {
      const to = address(r)
      if (!to) return { status: "skipped", reason: "no_email" }
      const a = available()
      if (!a.ok) return { status: "skipped", reason: a.reason }
      try {
        await sender({ to, subject: msg.subject, body: msg.html, text: msg.text })
        return { status: "sent" }
      } catch (err) {
        return { status: "failed", error: err instanceof Error ? err.message : String(err) }
      }
    },
  }
}

export const TELEGRAM_NOT_CONFIGURED = "telegram not configured"

/** Telegram channel — stub until the bot binding is built (phase 7, open part). */
export function telegramChannel(): DeliveryChannel {
  return {
    key: "telegram",
    available: () => ({ ok: false, reason: TELEGRAM_NOT_CONFIGURED }),
    address: (r) => r.telegramChatId,
    send: async () => ({ status: "skipped", reason: TELEGRAM_NOT_CONFIGURED }),
  }
}
