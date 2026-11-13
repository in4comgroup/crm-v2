import "server-only"
import { Output } from "ai"
import { aiCallInfo, aiGenerateText } from "@/server/ai/runtime"
import {
  blockClassifierSchema,
  buildBlockClassifierPrompt,
  buildExtractionSystemPrompt,
  buildItemPrompt,
  codesForSet,
  extractionOutputSchema,
  normalizeExtraction,
  type ExtractionCodeSet,
  type ExtractionEnvelope,
  type ExtractionVariant,
  type NormalizedExtraction,
} from "./extraction"

// One extraction of one text through the AI layer (process
// topics.signal_extraction; two_pass adds topics.signal_block_classifier).
// Org id explicit; the caller passes the usage `ref` (e.g. { evalRunId,
// goldenItemId }). Throws on a failed call — the caller records the error.

export const EXTRACTION_PROCESS = "topics.signal_extraction" as const
export const BLOCK_CLASSIFIER_PROCESS = "topics.signal_block_classifier" as const

export type ExtractionRun = {
  output: NormalizedExtraction | null
  variant: ExtractionVariant
  codeSet: ExtractionCodeSet
  /** Model that served the extraction call (null when pass 2 was skipped). */
  model: string | null
  classifierModel: string | null
  /** two_pass: blocks chosen by pass 1. */
  blocks: string[] | null
  codesInPrompt: number
  codeBlockChars: number
  systemChars: number
  inputTokens: number | null
  outputTokens: number | null
  durationMs: number
}

export async function runExtraction(args: {
  orgId: string
  text: string
  envelope: ExtractionEnvelope
  variant?: ExtractionVariant
  codeSet?: ExtractionCodeSet
  ref: Record<string, unknown>
}): Promise<ExtractionRun> {
  const variant = args.variant ?? "single"
  const codeSet = args.codeSet ?? "live"
  const started = Date.now()
  const allCodes = codesForSet(codeSet)
  const prompt = buildItemPrompt(args.envelope, args.text)

  let codes = allCodes
  let blocks: string[] | null = null
  let classifierModel: string | null = null
  if (variant === "two_pass") {
    const cls = buildBlockClassifierPrompt(allCodes)
    const pass1 = await aiGenerateText({
      process: BLOCK_CLASSIFIER_PROCESS,
      orgId: args.orgId,
      userId: null,
      ref: { ...args.ref, pass: 1 },
      output: Output.object({ schema: blockClassifierSchema }),
      system: cls.system,
      prompt,
      temperature: 0,
    })
    classifierModel = aiCallInfo(pass1)?.responseModel ?? null
    const known = new Set(cls.blocks)
    blocks = [...new Set(pass1.output.blocks.map((b) => b.trim().toUpperCase()))].filter((b) =>
      known.has(b),
    )
    const chosen = new Set(blocks)
    codes = allCodes.filter((c) => chosen.has(c.block))
    if (codes.length === 0) {
      return {
        output: null,
        variant,
        codeSet,
        model: null,
        classifierModel,
        blocks,
        codesInPrompt: 0,
        codeBlockChars: 0,
        systemChars: 0,
        inputTokens: pass1.totalUsage.inputTokens ?? null,
        outputTokens: pass1.totalUsage.outputTokens ?? null,
        durationMs: Date.now() - started,
      }
    }
  }

  const sys = buildExtractionSystemPrompt(codes)
  const result = await aiGenerateText({
    process: EXTRACTION_PROCESS,
    orgId: args.orgId,
    userId: null,
    ref: variant === "two_pass" ? { ...args.ref, pass: 2 } : args.ref,
    output: Output.object({ schema: extractionOutputSchema }),
    system: sys.system,
    prompt,
    temperature: 0,
  })
  return {
    output: normalizeExtraction(result.output, { allowedCodes: sys.codes, text: args.text }),
    variant,
    codeSet,
    model: aiCallInfo(result)?.responseModel ?? null,
    classifierModel,
    blocks,
    codesInPrompt: sys.codes.length,
    codeBlockChars: sys.codeBlockChars,
    systemChars: sys.systemChars,
    inputTokens: result.totalUsage.inputTokens ?? null,
    outputTokens: result.totalUsage.outputTokens ?? null,
    durationMs: Date.now() - started,
  }
}

/** Structured-output failures vs everything else (spike metric). */
export function classifyExtractionError(error: unknown): "structured_output" | "other" {
  const name = error instanceof Error ? error.name : ""
  const msg = error instanceof Error ? error.message : String(error)
  if (
    /NoObjectGenerated|TypeValidation|JSONParse|NoOutputGenerated/i.test(name) ||
    /no object generated|type validation failed|json parse|could not parse the response|response did not match schema/i.test(
      msg,
    )
  ) {
    return "structured_output"
  }
  return "other"
}
