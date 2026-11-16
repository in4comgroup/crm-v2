import "server-only"

import type { UIMessageChunk } from "ai"
import {
  EMPTY_ANSWER_FALLBACK,
  STATUS_WRITING,
  type ChatDebugPart,
  type ChatDebugStep,
  type ChatTurnPart,
  type ChatTurnSource,
} from "@/lib/chat/turn"

// Server-side strip of everything technical from the chat stream (spec §9,
// Q11): tool calls, tool inputs / outputs, reasoning text, provider sources
// and custom chunks NEVER reach the browser — for any user. What the user
// needs comes as our own data parts (written by the tools). On `finish` the
// filter adds `data-turn` («CRM · интернет · 7 с») and, for platform admins
// only, `data-debug` («Ход рассуждений»: reasoning + each tool call + model).

/** Chunk types that never reach the browser. */
const DROP = new Set([
  "reasoning-start",
  "reasoning-delta",
  "reasoning-end",
  "reasoning-file",
  "tool-input-start",
  "tool-input-delta",
  "tool-input-available",
  "tool-input-error",
  "tool-output-available",
  "tool-output-error",
  "tool-output-denied",
  "tool-approval-request",
  "tool-approval-response",
  "source-url",
  "source-document",
  "custom",
])

/** Debug text of one tool input / output (admins only). */
const DEBUG_MAX_CHARS = 6_000

const json = (v: unknown) => {
  let s: string
  try {
    s = typeof v === "string" ? v : JSON.stringify(v)
  } catch {
    s = String(v)
  }
  return s.length > DEBUG_MAX_CHARS ? `${s.slice(0, DEBUG_MAX_CHARS)}…` : s
}

export type ChatStreamFilterOptions = {
  isAdmin: boolean
  startedAt: number
  /** Tool name → which data it used (crm / web). */
  sourceOf: (tool: string) => ChatTurnSource | null
  /** The model that answered (admins); awaited briefly at `finish`. */
  model: () => Promise<string | null>
  now?: () => number
}

export type ChatStreamSummary = { tools: string[]; steps: number; ms: number; calls: ChatDebugStep[]; emptyAnswer: boolean }

export function createChatStreamFilter(opts: ChatStreamFilterOptions): {
  stream: TransformStream<UIMessageChunk, UIMessageChunk>
  summary: () => ChatStreamSummary
} {
  const now = opts.now ?? Date.now
  const steps: ChatDebugStep[] = []
  const starts = new Map<string, { tool: string; input: unknown; t: number; index: number }>()
  const used = new Set<ChatTurnSource>()
  const toolNames: string[] = []
  let reasoning = ""
  let stepCount = 0
  let wroteText = false
  let failed = false
  let emptyAnswer = false

  const stream = new TransformStream<UIMessageChunk, UIMessageChunk>({
    async transform(chunk, controller) {
      switch (chunk.type) {
        case "reasoning-start":
          reasoning = ""
          return
        case "reasoning-delta":
          reasoning += chunk.delta
          return
        case "reasoning-end":
          if (reasoning.trim()) steps.push({ kind: "reasoning", text: reasoning.trim() })
          reasoning = ""
          return
        case "tool-input-available": {
          const src = opts.sourceOf(chunk.toolName)
          if (src) used.add(src)
          toolNames.push(chunk.toolName)
          steps.push({ kind: "tool", tool: chunk.toolName, input: json(chunk.input), output: "", ms: 0 })
          starts.set(chunk.toolCallId, { tool: chunk.toolName, input: chunk.input, t: now(), index: steps.length - 1 })
          return
        }
        case "tool-input-error":
          steps.push({ kind: "tool", tool: chunk.toolName, input: json(chunk.input), output: chunk.errorText, ms: 0, error: true })
          return
        case "tool-output-available":
        case "tool-output-error": {
          const s = starts.get(chunk.toolCallId)
          if (s) {
            const step = steps[s.index]
            if (step?.kind === "tool") {
              step.ms = now() - s.t
              step.output = chunk.type === "tool-output-available" ? json(chunk.output) : chunk.errorText
              if (chunk.type === "tool-output-error") step.error = true
            }
          }
          return
        }
        case "start-step":
          stepCount += 1
          // After a tool step the model writes (or calls the next tool, which sets its own status).
          if (stepCount > 1) controller.enqueue({ type: "data-status", data: STATUS_WRITING, transient: true } as UIMessageChunk)
          controller.enqueue(chunk)
          return
        case "text-delta":
          if (chunk.delta.trim()) wroteText = true
          controller.enqueue(chunk)
          return
        case "error":
          failed = true
          controller.enqueue(chunk)
          return
        case "finish": {
          // The model ended the turn without a word (seen once in ≈ 250 eval
          // turns): never leave the user with an empty answer.
          if (!wroteText && !failed) {
            emptyAnswer = true
            controller.enqueue({ type: "text-start", id: "fallback" })
            controller.enqueue({ type: "text-delta", id: "fallback", delta: EMPTY_ANSWER_FALLBACK })
            controller.enqueue({ type: "text-end", id: "fallback" })
          }
          const turn: ChatTurnPart = { used: [...used], ms: now() - opts.startedAt }
          controller.enqueue({ type: "data-turn", id: "turn", data: turn } as UIMessageChunk)
          if (opts.isAdmin) {
            const model = await Promise.race([
              opts.model().catch(() => null),
              new Promise<null>((r) => setTimeout(() => r(null), 1_500)),
            ])
            const debug: ChatDebugPart = { model, steps }
            controller.enqueue({ type: "data-debug", id: "debug", data: debug } as UIMessageChunk)
          }
          controller.enqueue(chunk)
          return
        }
        default:
          if (DROP.has(chunk.type)) return
          // Q6: a composed json-render view is for non-CRM content only. When
          // the turn used CRM data, the app already shows it (records / stats
          // blocks) — a model-made table of the same data is dropped.
          if (chunk.type === "data-spec" && used.has("crm")) return
          controller.enqueue(chunk)
      }
    },
  })

  return {
    stream,
    summary: () => ({ tools: toolNames, steps: stepCount, ms: now() - opts.startedAt, calls: steps.filter((s) => s.kind === "tool"), emptyAnswer }),
  }
}
