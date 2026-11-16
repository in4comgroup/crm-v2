import "server-only"

import { CHAT_ERROR_PREFIX, type ChatErrorClass } from "@/lib/chat/turn"

// Error classes of the AI chat (spec §9 «Errors»). The browser never gets
// `error.message` (it may name the model, the provider or a key) — only
// `chat_error:<class>`, which the UI shows in Russian with «Повторить».
// Details go to the server log with the request id.

export function classifyChatError(e: unknown): ChatErrorClass {
  const err = e as { name?: string; message?: string; period?: string; cause?: unknown } | null
  const name = err?.name ?? ""
  const msg = (err?.message ?? String(e ?? "")).toLowerCase()
  if (name === "AiBudgetExceededError" && err?.period === "month") return "limit"
  // No compatible / policy-compliant model for the process.
  if (name === "AiProcessResolutionError") return "model_unavailable"
  if (name === "TimeoutError" || name === "AbortError" || /timeout|timed out|aborted/.test(msg)) return "timeout"
  if (
    /^(AiPolicyError|AiCapabilityUnavailableError|AI_APICallError|APICallError|GatewayError)/.test(name) ||
    /gateway|provider|model|rate limit|overloaded|unavailable|503|502|429/.test(msg)
  ) {
    return "model_unavailable"
  }
  if (err?.cause && err.cause !== e) return classifyChatError(err.cause)
  return "unknown"
}

export function chatErrorCode(cls: ChatErrorClass): string {
  return `${CHAT_ERROR_PREFIX}${cls}`
}
