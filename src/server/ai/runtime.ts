import "server-only"

import {
  generateText,
  streamText,
  type Output,
  type GenerateTextResult,
  type StreamTextResult,
  type ToolSet,
} from "ai"
import type { AiProcessKey } from "@/server/ai/processes"
import { resolveProcess, type ResolvedProcess } from "@/server/ai/registry/assignments"
import { recordUsageEvent, sumUsage, type UsageLike } from "@/server/ai/usage"
import type {
  AiProviderOptions,
  AiResultInfo,
  AiResultLike,
  AiToolCapability,
} from "@/server/ai/types"

// Runtime entry points (docs/specs/models/01-gateway-providers.md §6).
//
// Business code calls aiGenerateText / aiStreamText with a PROCESS key —
// never a model id, a gateway or a vendor package. Per call:
//   1. resolve the process → gateway + model + fallbacks (03 §4);
//   2. the gateway adapter builds the model handle, provider options and
//      any capability tools (e.g. web search);
//   3. call AI SDK core with the caller's params;
//   4. record one usage event (ai_usage_event) per call — ok, error or
//      aborted; recording never breaks the call.
// The SDK result is returned unchanged; aiCallInfo(result) tells what ran.

type AnyOutput = Output.Output
type GenerateParams<TOOLS extends ToolSet, OUTPUT extends AnyOutput> = Parameters<
  typeof generateText<TOOLS, OUTPUT>
>[0]
type StreamParams<TOOLS extends ToolSet, OUTPUT extends AnyOutput> = Parameters<
  typeof streamText<TOOLS, OUTPUT>
>[0]

/**
 * Who and what a call is for. `orgId` and `userId` are required keys: pass
 * null explicitly when there is none (background jobs have no user). A call
 * without an organization must say `systemCall: true`.
 */
export type AiCallContext = {
  process: AiProcessKey
  userId: string | null
  // User's pick, only honoured for user-selectable processes and only from
  // the admin-allowed list; otherwise ignored.
  requestedModelId?: string | null
  // Vendor tools to attach, supplied by the gateway adapter for the
  // resolved model (e.g. "web_search" → Google grounding on Google models).
  capabilities?: AiToolCapability[]
  // Optional business reference stored on the usage event, e.g.
  // { sourceItemId }.
  ref?: Record<string, unknown>
} & ({ orgId: string; systemCall?: false } | { orgId: null; systemCall: true })

export type AiCallInfo = AiResultInfo & {
  process: string
  gatewayId: string
  requestModel: string
}

// Result object → what ran. Results are SDK class instances (getters), so
// they are not copied or extended; the info sits beside them.
const callInfo = new WeakMap<object, { resolved: ResolvedProcess }>()

export class AiCapabilityUnavailableError extends Error {}

function prepare(
  ctx: AiCallContext,
  resolved: ResolvedProcess,
  modelId: string,
  fallbackModelIds: string[],
  callerTools: ToolSet | undefined,
  callerProviderOptions: AiProviderOptions | undefined,
) {
  const { adapter, gateway } = resolved
  let tools: ToolSet | undefined = callerTools
  for (const cap of ctx.capabilities ?? []) {
    const capTools = adapter.capabilityTools(cap, { modelId, vendor: resolved.vendor })
    if (!capTools) {
      throw new AiCapabilityUnavailableError(
        `Capability ${cap} is not available for ${modelId} (process ${ctx.process})`,
      )
    }
    tools = { ...(tools ?? {}), ...capTools }
  }
  const gatewayOptions = adapter.callOptions(
    {
      process: ctx.process,
      orgId: ctx.orgId,
      userId: ctx.userId,
      fallbackModelIds: adapter.fallbackModelsSupported ? fallbackModelIds : [],
      privacy: resolved.privacy,
    },
    gateway,
  )
  // Caller options (e.g. a vendor's thinking config) are merged per vendor key.
  const providerOptions: AiProviderOptions = { ...(callerProviderOptions ?? {}) }
  for (const [k, v] of Object.entries(gatewayOptions)) {
    providerOptions[k] = { ...(providerOptions[k] ?? {}), ...v }
  }
  return {
    model: adapter.languageModel(modelId, gateway),
    tools,
    providerOptions,
  }
}

function applySettings<T extends { temperature?: number; maxOutputTokens?: number }>(
  params: T,
  settings: ResolvedProcess["assignmentSettings"],
): T {
  if (!settings) return params
  return {
    ...params,
    ...(params.temperature === undefined && settings.temperature !== undefined
      ? { temperature: settings.temperature }
      : {}),
    ...(params.maxOutputTokens === undefined && settings.maxOutputTokens !== undefined
      ? { maxOutputTokens: settings.maxOutputTokens }
      : {}),
  }
}

function splitContext<T extends AiCallContext>(args: T) {
  const { process, orgId, userId, requestedModelId, capabilities, systemCall, ref, ...params } = args
  return {
    ctx: { process, orgId, userId, requestedModelId, capabilities, systemCall, ref } as AiCallContext,
    params,
  }
}

export async function aiGenerateText<
  TOOLS extends ToolSet = ToolSet,
  OUTPUT extends AnyOutput = Output.Output<string, string>,
>(
  args: AiCallContext & Omit<GenerateParams<TOOLS, OUTPUT>, "model">,
): Promise<GenerateTextResult<TOOLS, OUTPUT>> {
  const { ctx, params } = splitContext(args)
  const resolved = await resolveProcess(ctx.process, ctx.requestedModelId)
  const base = applySettings(
    params as GenerateParams<TOOLS, OUTPUT>,
    resolved.assignmentSettings,
  )

  // Gateways without their own model fallback: retry the list here.
  const chain = resolved.adapter.fallbackModelsSupported
    ? [resolved.modelId]
    : [resolved.modelId, ...resolved.fallbackModelIds]
  let lastError: unknown
  for (const [i, modelId] of chain.entries()) {
    const startedAt = new Date()
    try {
      const { model, tools, providerOptions } = prepare(
        ctx,
        resolved,
        modelId,
        resolved.fallbackModelIds,
        base.tools as ToolSet | undefined,
        base.providerOptions,
      )
      const result = await generateText<TOOLS, OUTPUT>({
        ...base,
        model,
        ...(tools ? { tools: tools as TOOLS } : {}),
        providerOptions,
      })
      callInfo.set(result, { resolved: { ...resolved, modelId } })
      await recordUsageEvent({
        resolved,
        orgId: ctx.orgId,
        userId: ctx.userId,
        ref: ctx.ref,
        startedAt,
        status: "ok",
        usage: result.totalUsage as UsageLike,
        steps: result.steps.length,
        info: resolved.adapter.readResult(result, resolved.gateway),
        requestModel: modelId,
      })
      return result
    } catch (error) {
      lastError = error
      if (!(error instanceof AiCapabilityUnavailableError)) {
        await recordUsageEvent({
          resolved,
          orgId: ctx.orgId,
          userId: ctx.userId,
          ref: ctx.ref,
          startedAt,
          status: "error",
          error,
          requestModel: modelId,
        })
      }
      if (i === chain.length - 1 || error instanceof AiCapabilityUnavailableError) throw error
      console.warn(`[ai] ${ctx.process}: ${modelId} failed, trying next fallback`, error)
    }
  }
  throw lastError
}

export async function aiStreamText<
  TOOLS extends ToolSet = ToolSet,
  OUTPUT extends AnyOutput = Output.Output<string, string, never>,
>(
  args: AiCallContext & Omit<StreamParams<TOOLS, OUTPUT>, "model">,
): Promise<StreamTextResult<TOOLS, OUTPUT>> {
  const { ctx, params } = splitContext(args)
  const resolved = await resolveProcess(ctx.process, ctx.requestedModelId)
  const base = applySettings(
    params as StreamParams<TOOLS, OUTPUT>,
    resolved.assignmentSettings,
  )
  // Streams rely on gateway-side fallbacks only (a mid-stream retry would
  // duplicate output).
  const { model, tools, providerOptions } = prepare(
    ctx,
    resolved,
    resolved.modelId,
    resolved.fallbackModelIds,
    base.tools as ToolSet | undefined,
    base.providerOptions,
  )
  const startedAt = new Date()
  const record = (
    status: "ok" | "error" | "aborted",
    extra: Partial<Parameters<typeof recordUsageEvent>[0]>,
  ) =>
    recordUsageEvent({
      resolved,
      orgId: ctx.orgId,
      userId: ctx.userId,
      ref: ctx.ref,
      startedAt,
      status,
      requestModel: resolved.modelId,
      ...extra,
    })
  const { onFinish, onError, onAbort } = base
  const result = streamText<TOOLS, OUTPUT>({
    ...base,
    model,
    ...(tools ? { tools: tools as TOOLS } : {}),
    providerOptions,
    // Usage recording wraps the caller's own callbacks (which still run).
    onFinish: async (event) => {
      await record("ok", {
        usage: event.totalUsage as UsageLike,
        steps: event.steps.length,
        info: resolved.adapter.readResult(event, resolved.gateway),
      })
      await onFinish?.(event)
    },
    onError: async (event) => {
      await record("error", { error: event.error })
      await onError?.(event)
    },
    onAbort: async (event) => {
      await record("aborted", {
        usage: sumUsage(event.steps.map((s) => s.usage as UsageLike)),
        steps: event.steps.length,
        info: event.steps.length
          ? resolved.adapter.readResult(
              { ...event.steps[event.steps.length - 1], steps: event.steps },
              resolved.gateway,
            )
          : null,
      })
      await onAbort?.(event)
    },
  })
  callInfo.set(result, { resolved })
  return result
}

/**
 * What actually ran for a result of aiGenerateText / aiStreamText, in
 * OpenTelemetry GenAI terms. `responseModel` falls back to the requested
 * model when the gateway does not report one. Use it e.g. to stamp
 * `source_item.parser_model`.
 */
export function aiCallInfo(result: object & AiResultLike): AiCallInfo | null {
  const entry = callInfo.get(result)
  if (!entry) return null
  const { resolved } = entry
  const info = resolved.adapter.readResult(result, resolved.gateway)
  return {
    ...info,
    responseModel: info.responseModel ?? resolved.modelId,
    process: resolved.process.key,
    gatewayId: resolved.gateway.id,
    requestModel: resolved.modelId,
  }
}
