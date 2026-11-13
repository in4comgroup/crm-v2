import { NextResponse, type NextRequest } from "next/server"
import { getServerSession } from "@/lib/get-session"
import { AI_PROCESSES } from "@/server/ai/processes"
import {
  AssignmentValidationError,
  listAssignmentLog,
  listCompatibleModelIds,
  listProcessStatuses,
  resetProcessAssignment,
  saveProcessAssignment,
} from "@/server/ai/registry/assignments"
import { getAiModelNames, getAiModelRows } from "@/server/ai/registry/models"
import { getModelPrice } from "@/server/ai/registry/assignments"
import { costPer1000Calls, processUsageLast30d } from "@/server/ai/usage-stats"

// «Процессы ИИ» (AI processes) tab on /settings. Platform admins only.
//   GET                                   → { processes: AdminAiProcess[] }
//   GET ?compatible=<key>&gatewayId=      → { models: (AiModelListRow & { costPer1000 })[], incompatibleCount, hasUsage }
//   GET ?log=<key>                        → { log }
//   PUT { processKey, gatewayId, primaryModelId, fallbackModelIds, allowedModelIds }
//   PUT { processKey, reset: true }       → back to the code default
// Spec: docs/specs/models/03-processes-and-model-selection.md §4, §5.

export type AdminAiProcess = {
  key: string
  label: string
  group: string
  description: string
  kind: "interactive" | "background"
  requires: string[]
  defaultModelId: string
  userSelectable: boolean
  gatewayId: string | null
  primaryModelId: string
  fallbackModelIds: string[]
  allowedModelIds: string[]
  effectiveModelId: string
  isDefault: boolean
  problems: { modelId: string; reason: string; capability?: string }[]
  updatedAt: string | null
  models: Record<string, { name: string; vendor: string | null }>
  // Last 30 days (successful calls); null = no usage yet.
  usage30d: { calls: number; cost: number; avgInputTokens: number; avgOutputTokens: number } | null
  // ≈ cost of 1,000 calls on the current primary model, from the average
  // tokens of this process; null = no usage yet or no price.
  costPer1000: number | null
}

async function requireAdmin() {
  const session = await getServerSession()
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  }
  if (session.user.role !== "admin") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  }
  return { userId: session.user.id }
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  const sp = request.nextUrl.searchParams
  try {
    const compatibleFor = sp.get("compatible")
    if (compatibleFor) {
      const gatewayId = sp.get("gatewayId")
      if (!gatewayId) {
        return NextResponse.json({ error: "gatewayId is required" }, { status: 400 })
      }
      const [{ compatible, incompatible }, usage] = await Promise.all([
        listCompatibleModelIds(compatibleFor, gatewayId),
        processUsageLast30d(),
      ])
      const rows = await getAiModelRows(gatewayId, compatible)
      const u = usage[compatibleFor]
      return NextResponse.json({
        models: rows.map((m) => ({
          ...m,
          costPer1000: costPer1000Calls(u, {
            input: m.costInput == null ? null : Number(m.costInput),
            output: m.costOutput == null ? null : Number(m.costOutput),
          }),
        })),
        incompatibleCount: incompatible.length,
        hasUsage: !!u,
      })
    }
    const logFor = sp.get("log")
    if (logFor) {
      return NextResponse.json({ log: await listAssignmentLog(logFor) })
    }

    const [statuses, usage] = await Promise.all([listProcessStatuses(), processUsageLast30d()])
    const byKey = new Map(statuses.map((s) => [s.key, s]))
    // Names for every model mentioned, per gateway.
    const idsByGateway = new Map<string, Set<string>>()
    for (const s of statuses) {
      if (!s.gatewayId) continue
      const set = idsByGateway.get(s.gatewayId) ?? new Set<string>()
      const a = s.assignment
      for (const id of [
        s.effectiveModelId,
        ...(a ? [a.primaryModelId, ...a.fallbackModelIds] : []),
        ...s.allowedModelIds,
      ]) set.add(id)
      idsByGateway.set(s.gatewayId, set)
    }
    const names = new Map<string, Map<string, { name: string; vendor: string | null }>>()
    for (const [gw, ids] of idsByGateway) names.set(gw, await getAiModelNames(gw, [...ids]))

    const processes: AdminAiProcess[] = []
    for (const p of AI_PROCESSES) {
      const s = byKey.get(p.key)!
      const a = s.assignment
      const u = usage[p.key] ?? null
      const price = s.gatewayId ? await getModelPrice(s.gatewayId, s.effectiveModelId) : null
      processes.push({
        key: p.key,
        label: p.label,
        group: p.group,
        description: p.description,
        kind: p.kind,
        requires: p.requires,
        defaultModelId: p.defaultModelId,
        userSelectable: !!p.userSelectable,
        gatewayId: s.gatewayId,
        primaryModelId: a?.primaryModelId ?? p.defaultModelId,
        fallbackModelIds: a?.fallbackModelIds ?? [],
        allowedModelIds: s.allowedModelIds,
        effectiveModelId: s.effectiveModelId,
        isDefault: s.isDefault,
        problems: s.problems.map((x) => ({
          modelId: x.modelId,
          reason: x.problem.reason,
          ...("capability" in x.problem ? { capability: x.problem.capability } : {}),
        })),
        updatedAt: a?.updatedAt ? new Date(a.updatedAt).toISOString() : null,
        models: Object.fromEntries(names.get(s.gatewayId ?? "") ?? []),
        usage30d: u,
        costPer1000: costPer1000Calls(u ?? undefined, price),
      })
    }
    return NextResponse.json({ processes })
  } catch (error) {
    console.error("[admin/ai/processes] GET error:", error)
    return NextResponse.json({ error: "Failed to load processes" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const processKey = typeof body?.processKey === "string" ? body.processKey : ""
  const strArr = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []
  try {
    if (body?.reset === true) {
      await resetProcessAssignment(processKey, auth.userId)
      return NextResponse.json({ ok: true })
    }
    const gatewayId = typeof body?.gatewayId === "string" ? body.gatewayId : ""
    const primaryModelId = typeof body?.primaryModelId === "string" ? body.primaryModelId : ""
    if (!gatewayId || !primaryModelId) {
      return NextResponse.json({ error: "gatewayId и primaryModelId обязательны" }, { status: 400 })
    }
    await saveProcessAssignment(
      {
        processKey,
        gatewayId,
        primaryModelId,
        fallbackModelIds: strArr(body?.fallbackModelIds),
        allowedModelIds: strArr(body?.allowedModelIds),
      },
      auth.userId,
    )
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof AssignmentValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    console.error("[admin/ai/processes] PUT error:", error)
    return NextResponse.json({ error: "Failed to save" }, { status: 500 })
  }
}
