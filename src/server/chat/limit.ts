import "server-only"

import { chatMonthlyLimitMessageRu } from "@/lib/ai-budget"
import { getOrgBudgetStatus } from "@/server/ai/budget"

// Monthly AI limit for the AI chat (docs/specs/ai-chat/01 §4, Q15). The
// runtime refuses `chat.assistant` / `chat.web_search` at 100 % of the
// monthly limit (`stopAtMonthlyLimit`); this is the check the chat does
// BEFORE a model call (route pre-check, chat status on open), so the user
// gets a Russian message instead of a failed stream.

export type ChatLimitState = { blocked: boolean; message: string | null; resetsAt: string | null }

export async function getChatLimitState(orgId: string): Promise<ChatLimitState> {
  const status = await getOrgBudgetStatus(orgId)
  if (status.monthly.level !== "exceeded") return { blocked: false, message: null, resetsAt: null }
  return {
    blocked: true,
    message: chatMonthlyLimitMessageRu(status.monthly.resetsAt),
    resetsAt: status.monthly.resetsAt,
  }
}

/** Body of the 402 the chat route returns; the chat UI reads `error`. */
export const CHAT_LIMIT_ERROR = "monthly_limit" as const
