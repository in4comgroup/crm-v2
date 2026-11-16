// Parse one chat turn (the UI message stream of POST /api/chat) into what
// the eval checks (docs/specs/ai-chat/01-specification.md §12). Pure —
// unit-tested; no server-only import so the test runs plainly.
import type { ChatDraftPart } from "@/lib/chat/actions"

import {
  CHAT_ERROR_PREFIX,
  mergeEvidenceParts,
  mergeRecordsParts,
  type ChatDebugPart,
  type ChatEvidencePart,
  type ChatRecordsPart,
  type ChatTurnPart,
} from "@/lib/chat/turn"
import type { RecordHit } from "@/lib/chat/records"
import type { StatsResult } from "@/lib/chat/stats"

export type StreamChunk = { type: string; [k: string]: unknown }

export type ToolCall = { tool: string; input: Record<string, unknown>; output: string; error: boolean; ms: number }

export type TurnResult = {
  httpStatus: number
  /** «chat_error:<class>» of the stream, or null. */
  error: string | null
  answer: string
  chunkTypes: string[]
  tools: ToolCall[]
  model: string | null
  records: ChatRecordsPart | null
  hits: RecordHit[]
  stats: StatsResult[]
  evidence: ChatEvidencePart | null
  turn: ChatTurnPart | null
  /** Draft cards of the answer (ai-chat-tools T1), last version per card. */
  drafts: ChatDraftPart[]
  ms: number
}

/** Lines `data: {…}` of an SSE body → chunks. */
export function parseSse(body: string): StreamChunk[] {
  return body
    .split("\n")
    .filter((l) => l.startsWith("data: ") && l.trim() !== "data: [DONE]")
    .flatMap((l) => {
      try {
        return [JSON.parse(l.slice(6)) as StreamChunk]
      } catch {
        return []
      }
    })
}

function parseInput(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s)
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export function turnResult(httpStatus: number, chunks: StreamChunk[], ms: number): TurnResult {
  const data = <T>(name: string) => chunks.filter((c) => c.type === `data-${name}`).map((c) => c.data as T)
  const debug = data<ChatDebugPart>("debug")[0] ?? null
  const records = mergeRecordsParts(data<ChatRecordsPart>("records"))
  const errorChunk = chunks.find((c) => c.type === "error")
  return {
    httpStatus,
    error: errorChunk ? String(errorChunk.errorText ?? `${CHAT_ERROR_PREFIX}unknown`) : null,
    answer: chunks
      .filter((c) => c.type === "text-delta")
      .map((c) => String(c.delta ?? ""))
      .join(""),
    chunkTypes: [...new Set(chunks.map((c) => c.type))],
    tools: (debug?.steps ?? []).flatMap((s) =>
      s.kind === "tool" ? [{ tool: s.tool, input: parseInput(s.input), output: s.output, error: !!s.error, ms: s.ms }] : [],
    ),
    model: debug?.model ?? null,
    records,
    hits: records ? Object.values(records.hits).flatMap((l) => l ?? []) : [],
    stats: data<StatsResult>("stats"),
    evidence: mergeEvidenceParts(data<ChatEvidencePart>("evidence")),
    turn: data<ChatTurnPart>("turn")[0] ?? null,
    drafts: [...new Map(data<ChatDraftPart>("draft").map((d) => [d.actionId, d])).values()],
    ms,
  }
}

// ── Checks every case gets (spec §9, §11, §12) ────────────────────────

export const TOOL_NAMES = ["searchRecords", "listRecords", "getRecord", "readSource", "queryStats", "searchWeb", "draftCompany", "draftContact", "draftTask", "draftTasks"]

/** Things a user must never see in the answer text. */
export function leakProblems(answer: string): string[] {
  const out: string[] = []
  if (/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(answer)) out.push("id (uuid) in the answer")
  if (/\b(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Z])[A-Za-z0-9]{32}\b/.test(answer)) out.push("id (32 chars) in the answer")
  for (const t of TOOL_NAMES) if (answer.includes(t)) out.push(`tool name «${t}» in the answer`)
  if (/\bref\b|"ref"\s*:/.test(answer)) out.push("«ref» in the answer")
  if (/\{\s*"[a-zA-Z]+"\s*:/.test(answer)) out.push("JSON in the answer")
  if (/tool_code|print\(/.test(answer)) out.push("fake tool call in the answer")
  return out
}

/** Chunk types that must never reach the browser (the route strips them). */
export function forbiddenChunks(types: readonly string[]): string[] {
  return types.filter((t) => /^(tool-|reasoning-|source-|custom$)/.test(t))
}

/** «2 753» / «2753» / «2 753,5» → digits for matching numbers in prose. */
export function normaliseNumbers(text: string): string {
  return text.replace(/(\d)[\s  ](?=\d{3}\b)/g, "$1")
}

/** Does the answer mention the number (ignoring thousand separators)? */
export function mentionsNumber(answer: string, n: number): boolean {
  const t = normaliseNumbers(answer)
  return new RegExp(`(^|[^\\d])${String(Math.round(n))}([^\\d]|$)`).test(t)
}

/** Relative difference within tolerance (default 0.5 %, or ±1 for small counts). */
export function closeTo(actual: number, expected: number, tol = 0.005): boolean {
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) return false
  return Math.abs(actual - expected) <= Math.max(1, Math.abs(expected) * tol)
}
