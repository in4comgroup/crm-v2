import nylas from "@/lib/nylas"

/**
 * System mail (sign-in codes, invitations, topics digests) is sent through
 * Nylas only — from the platform mailbox of NYLAS_GRANT_ID (hello@truffalo.ai).
 * The Resend alternative was removed 2026-11-16 (Nylas is the only provider).
 */

interface SendEmailValues {
  to: string
  subject: string
  /** HTML body. */
  body: string
  /**
   * Optional plain-text alternative. The Nylas send API has no separate text
   * part, so it is not sent; callers keep it for a future provider.
   */
  text?: string
}

export type EmailProviderStatus =
  | { configured: true; provider: "nylas" }
  | { configured: false; provider: "nylas"; reason: string }

/**
 * Is outgoing system mail configured in this environment? Checks only the
 * env vars Nylas needs (no network call). Used by callers that must never
 * throw on a missing provider (topics digests record `skipped`).
 */
export function emailProviderStatus(): EmailProviderStatus {
  const missing = ["NYLAS_API_KEY", "NYLAS_GRANT_ID"].filter((k) => !process.env[k])
  return missing.length
    ? { configured: false, provider: "nylas", reason: `${missing.join(", ")} not configured` }
    : { configured: true, provider: "nylas" }
}

// --- Nylas ------------------------------------------------------------------

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
  return sendEmailsViaNylas(values)
}
