import "server-only"

import { Output } from "ai"
import { aiGenerateText } from "@/server/ai/runtime"
import { sanitizeCardText } from "./logic"
import {
  buildCardWriterPrompt,
  CARD_WRITER_PROCESS,
  CARD_WRITER_SYSTEM,
  cardWriterSchema,
  type CardWriter,
} from "./prompt"

export {
  buildCardWriterPrompt,
  CARD_WRITER_PROCESS,
  type CardWriter,
  type CardWriterInput,
  type CardWriterOutput,
} from "./prompt"

// Card writer (spec topics/01 §9.1; AI process `topics.card_writer`). Gets
// one topic (title, matter, counterparty, lead code, evidence quotes, recent
// items, deadlines) and the current card text, and returns NEW / UPDATE /
// NOOP + Russian card text. The model NEVER sees the score, band or profile:
// engine fields are written by code. The card id for UPDATE must be COPIED;
// the phase treats any other id as NEW (logic.ts resolveCardAction). Output
// is trimmed to the §9.1 word limits in code.

/** The production writer: one `topics.card_writer` call. */
export function createLlmCardWriter(orgId: string): CardWriter {
  return async (input) => {
    const result = await aiGenerateText({
      process: CARD_WRITER_PROCESS,
      orgId,
      userId: null,
      ref: { topicId: input.topicId, ...(input.sourceItemId ? { sourceItemId: input.sourceItemId } : {}) },
      output: Output.object({ schema: cardWriterSchema }),
      instructions: CARD_WRITER_SYSTEM,
      prompt: buildCardWriterPrompt(input),
      temperature: 0.2,
    })
    const out = result.output
    return {
      decision: out.decision,
      cardId: (out.cardId ?? "").trim(),
      text: sanitizeCardText(out),
    }
  }
}
