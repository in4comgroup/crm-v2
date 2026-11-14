import { Resend } from "resend"
import nylas from "@/lib/nylas"

/**
 * Email sending is routed through Nylas by default — messages are sent from the
 * Gmail account connected via NYLAS_GRANT_ID (hello@truffalo.ai).
 *
 * The previous Resend implementation is preserved below as `sendEmailsViaResend`
 * so we can switch back, or route specific flows to Resend, without rewriting.
 *
 * To switch the default provider, set EMAIL_PROVIDER=resend | nylas in .env.
 */

// Created on first use, not at import: `new Resend()` throws when
// RESEND_API_KEY is unset, and this module is imported by src/lib/auth.ts —
// an eager client would crash every page when only Nylas is configured.
let resendClient: Resend | null = null
function getResend(): Resend {
  if (!resendClient) {
    if (!process.env.RESEND_API_KEY) {
      throw new Error("RESEND_API_KEY is not configured")
    }
    resendClient = new Resend(process.env.RESEND_API_KEY)
  }
  return resendClient
}

const RESEND_DEFAULT_FROM = "onboarding@resend.dev"

interface SendEmailValues {
  to: string
  subject: string
  /** HTML body. */
  body: string
  /**
   * Optional plain-text alternative. Resend sends it as the text/plain part;
   * the Nylas send API has no separate text part, so Nylas ignores it.
   */
  text?: string
}

export type EmailProviderStatus =
  | { configured: true; provider: "nylas" | "resend" }
  | { configured: false; provider: "nylas" | "resend"; reason: string }

/**
 * Is outgoing system mail configured in this environment? Checks only the
 * env vars the active provider needs (no network call). Used by callers that
 * must never throw on a missing provider (topics digests record `skipped`).
 */
export function emailProviderStatus(): EmailProviderStatus {
  const provider = (process.env.EMAIL_PROVIDER ?? "nylas").toLowerCase() === "resend" ? "resend" : "nylas"
  if (provider === "resend") {
    return process.env.RESEND_API_KEY
      ? { configured: true, provider }
      : { configured: false, provider, reason: "RESEND_API_KEY is not configured" }
  }
  const missing = ["NYLAS_API_KEY", "NYLAS_GRANT_ID"].filter((k) => !process.env[k])
  return missing.length
    ? { configured: false, provider, reason: `${missing.join(", ")} not configured` }
    : { configured: true, provider }
}

// --- Resend (legacy / fallback) --------------------------------------------

export async function sendEmailsViaResend({
  to,
  subject,
  body,
  text,
}: SendEmailValues) {
  const from = process.env.RESEND_FROM || RESEND_DEFAULT_FROM
  const { data, error } = await getResend().emails.send({
    from,
    to,
    subject,
    html: body,
    ...(text ? { text } : {}),
  })
  if (error) {
    console.error("[resend] send failed", { to, subject, from, error })
    throw new Error(
      `Resend error: ${error.message ?? JSON.stringify(error)}`,
    )
  }
  return data
}

// --- Nylas (default) -------------------------------------------------------

export async function sendEmailsViaNylas({
  to,
  subject,
  body,
}: SendEmailValues) {
  const grantId = process.env.NYLAS_GRANT_ID
  if (!grantId) {
    throw new Error("NYLAS_GRANT_ID is not configured")
  }
  try {
    const { data } = await nylas.messages.send({
      identifier: grantId,
      requestBody: {
        to: [{ email: to }],
        subject,
        body,
      },
    })
    return data
  } catch (err) {
    console.error("[nylas] send failed", {
      to,
      subject,
      grantId,
      err,
    })
    throw err instanceof Error ? err : new Error(String(err))
  }
}

// --- Dispatcher ------------------------------------------------------------

export async function sendEmails(values: SendEmailValues) {
  const provider = (process.env.EMAIL_PROVIDER ?? "nylas").toLowerCase()
  if (provider === "resend") return sendEmailsViaResend(values)
  return sendEmailsViaNylas(values)
}
