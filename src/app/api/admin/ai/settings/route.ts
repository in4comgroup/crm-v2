import { NextResponse, type NextRequest } from "next/server"
import { getServerSession } from "@/lib/get-session"
import { getAiProcess } from "@/server/ai/processes"
import {
  getAiModelPolicy,
  invalidateAiRegistryCache,
  processesBlockedByPolicy,
} from "@/server/ai/registry/assignments"
import {
  getPlatformSetting,
  listPlatformSettingLog,
  PlatformSettingValidationError,
  setPlatformSetting,
} from "@/server/platform-settings"
import { listAiLanguageVendors } from "@/server/ai/registry/models"

// AI platform settings: markup (spec 05) and model policy (spec 03 §7).
// Platform admins only.
//   GET → { markupPercent, markupLog, policy, policyLog, vendors }
//   PUT { markupPercent }                            → save markup
//   PUT { policy: { zdrOnly, noTrainingOnly, allowedVendors } }
//       → 409 { error, blockedProcesses } when a process would be left with
//         no compliant model; nothing is saved then.

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

export type AdminAiSettingsResponse = {
  markupPercent: number
  markupLog: Awaited<ReturnType<typeof listPlatformSettingLog>>
  policy: Awaited<ReturnType<typeof getAiModelPolicy>>
  policyLog: Awaited<ReturnType<typeof listPlatformSettingLog>>
  vendors: string[]
}

export async function GET() {
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  try {
    const [markupPercent, markupLog, policy, zdrLog, trainLog, vendorLog, vendorRows] = await Promise.all([
      getPlatformSetting("ai.markup_percent"),
      listPlatformSettingLog("ai.markup_percent"),
      getAiModelPolicy(),
      listPlatformSettingLog("ai.policy.zdr_only", 5),
      listPlatformSettingLog("ai.policy.no_training_only", 5),
      listPlatformSettingLog("ai.policy.allowed_vendors", 5),
      listAiLanguageVendors(),
    ])
    const body: AdminAiSettingsResponse = {
      markupPercent,
      markupLog,
      policy,
      policyLog: [...zdrLog, ...trainLog, ...vendorLog]
        .sort((a, b) => new Date(b.changedAt).getTime() - new Date(a.changedAt).getTime())
        .slice(0, 10),
      vendors: vendorRows,
    }
    return NextResponse.json(body)
  } catch (error) {
    console.error("[admin/ai/settings] GET error:", error)
    return NextResponse.json({ error: "Failed to load settings" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  try {
    if (body && "markupPercent" in body) {
      const v = await setPlatformSetting("ai.markup_percent", body.markupPercent, auth.userId)
      return NextResponse.json({ markupPercent: v })
    }
    if (body?.policy && typeof body.policy === "object") {
      const p = body.policy as Record<string, unknown>
      const policy = {
        zdrOnly: p.zdrOnly === true,
        noTrainingOnly: p.noTrainingOnly === true,
        allowedVendors: Array.isArray(p.allowedVendors)
          ? [...new Set(p.allowedVendors.filter((v): v is string => typeof v === "string" && v.length > 0))]
          : [],
      }
      const blocked = await processesBlockedByPolicy(policy)
      if (blocked.length) {
        return NextResponse.json(
          {
            error: "Для этих процессов не останется ни одной подходящей модели. Сначала выберите им модели, которые соответствуют правилам.",
            blockedProcesses: blocked.map((k) => getAiProcess(k)?.label ?? k),
          },
          { status: 409 },
        )
      }
      await setPlatformSetting("ai.policy.zdr_only", policy.zdrOnly, auth.userId)
      await setPlatformSetting("ai.policy.no_training_only", policy.noTrainingOnly, auth.userId)
      await setPlatformSetting("ai.policy.allowed_vendors", policy.allowedVendors, auth.userId)
      invalidateAiRegistryCache()
      return NextResponse.json({ policy })
    }
    return NextResponse.json({ error: "Nothing to save" }, { status: 400 })
  } catch (error) {
    if (error instanceof PlatformSettingValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    console.error("[admin/ai/settings] PUT error:", error)
    return NextResponse.json({ error: "Failed to save" }, { status: 500 })
  }
}
