import { NextRequest, NextResponse } from "next/server"
import {
  listDeals,
  listDealClientOptions,
  listDealContactOptions,
  listDealFunnelStages,
  createDeal,
  updateDeal,
  setDealStatus,
  moveDealStage,
  moveDeal,
  getDeal,
  listDealActivity,
  listRejectedDealOrigins,
  getFunnelStageSettingsView,
  saveFunnelStageSettings,
  getDealTypeSettings,
  saveDealTypeSettings,
  getDealProvenance,
  pauseDealForUser,
  resumeDealForUser,
  undoAgentCreatedDeal,
  getDealStateForUser,
  requestDealStateRefreshForUser,
  listDealRisksForUser,
  clearDealRiskForUser,
} from "@/server/deals"
import { DealEngineError } from "@/server/deal-engine"
import { DealRiskError } from "@/server/deal-risks"
import { DealStateError } from "@/server/deal-state"
import { AiBudgetExceededError } from "@/server/ai/budget"
import {
  DealTypeForbiddenError,
  FunnelStageForbiddenError,
  DealTypeValidationError,
} from "@/server/deal-types"
import type { DealStatus } from "@/db/schema"
import { DEAL_STATUSES } from "@/server/db-enums"
import {
  DEFAULT_STALE_NORM_DAYS,
  parseStaleNormInput,
  STALE_NORM_MAX_DAYS,
  STALE_NORM_MIN_DAYS,
} from "@/lib/deal-activity"

export {
  type DealRow,
  type DealClientOption,
  type DealContactOption,
  type DealFunnelStageOption,
  type DealContactSummary,
  type DealActivityRow,
  type FunnelStageSetting,
  type DealTypeOption,
  type DealProvenanceResult,
  type DealSourceRef,
  type DealStateResult,
  type DealRisksResult,
} from "@/server/deals"

// «Обновить» (action refreshState) runs one `deals.state_summary` LLM call.
export const maxDuration = 60

// Server guards throw short English messages; the UI shows `error` in a toast.
const RU_ERRORS: Record<string, string> = {
  Unauthorized: "Нет доступа к сделке",
  "No active organization": "Не выбрана организация",
  "Deal not found": "Сделка не найдена",
  "Unknown error": "Неизвестная ошибка",
}

function errorResponse(error: unknown) {
  if (error instanceof DealTypeForbiddenError || error instanceof FunnelStageForbiddenError) {
    return NextResponse.json({ error: error.message }, { status: 403 })
  }
  if (error instanceof DealTypeValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  if (error instanceof DealEngineError) {
    const status =
      error.code === "not_found" ? 404 : error.code === "forbidden" ? 403 : 400
    return NextResponse.json({ error: error.message }, { status })
  }
  if (error instanceof AiBudgetExceededError) {
    return NextResponse.json(
      { error: "Дневной бюджет ИИ исчерпан — попробуйте обновить состояние завтра" },
      { status: 409 },
    )
  }
  if (error instanceof DealRiskError || error instanceof DealStateError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.code === "not_found" ? 404 : 400 },
    )
  }
  const message = error instanceof Error ? error.message : "Unknown error"
  const status =
    message === "Unauthorized" || message === "No active organization"
      ? 403
      : message === "Deal not found"
        ? 404
        : 400
  return NextResponse.json({ error: RU_ERRORS[message] ?? message }, { status })
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url)
    if (url.searchParams.get("clientOptions") === "1") {
      const options = await listDealClientOptions()
      return NextResponse.json({ options })
    }
    if (url.searchParams.get("contactOptions") === "1") {
      const clientId = url.searchParams.get("clientId")
      const options = await listDealContactOptions(clientId)
      return NextResponse.json({ options })
    }
    if (url.searchParams.get("stageSettings") === "1") {
      // { stages, canManage } — only the org owner may save (PUT → 403 otherwise).
      return NextResponse.json(await getFunnelStageSettingsView())
    }
    // Deal types (org list; the owner edits it next to «Настройки стадий»).
    // Creates the generic defaults on first use.
    if (url.searchParams.get("dealTypes") === "1") {
      const { types, canManage } = await getDealTypeSettings()
      return NextResponse.json({ types, canManage })
    }
    if (url.searchParams.get("funnelStages") === "1") {
      const stages = await listDealFunnelStages()
      return NextResponse.json({ stages })
    }
    // Deal drawer «Происхождение»: topics + items + provenance journal.
    const provenanceFor = url.searchParams.get("provenanceFor")
    if (provenanceFor) {
      const provenance = await getDealProvenance(provenanceFor)
      return NextResponse.json({ provenance })
    }
    // Drawer «Текущее состояние» (phase 5a): stored text + version history.
    const stateFor = url.searchParams.get("stateFor")
    if (stateFor) {
      const state = await getDealStateForUser(stateFor)
      return NextResponse.json({ state })
    }
    // Drawer «Риски» (phase 5a): active + cleared risks with sources.
    const risksFor = url.searchParams.get("risksFor")
    if (risksFor) {
      const risks = await listDealRisksForUser(risksFor)
      return NextResponse.json({ risks })
    }
    const activityFor = url.searchParams.get("activityFor")
    if (activityFor) {
      const activity = await listDealActivity(activityFor)
      return NextResponse.json({ activity })
    }
    if (url.searchParams.get("rejectedOrigins") === "1") {
      const origins = await listRejectedDealOrigins()
      return NextResponse.json({ origins })
    }
    const id = url.searchParams.get("id")
    if (id) {
      const dealRow = await getDeal(id)
      if (!dealRow) {
        return NextResponse.json({ error: "Deal not found" }, { status: 404 })
      }
      return NextResponse.json({ deal: dealRow })
    }
    const includeCancelled =
      url.searchParams.get("includeCancelled") === "1"
    const includeDeleted = url.searchParams.get("includeDeleted") === "1"
    const deals = await listDeals({ includeCancelled, includeDeleted })
    return NextResponse.json({ deals })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      name,
      description,
      funnelStageId,
      clientId,
      contactIds,
      value,
      dealTypeId,
    } = body
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 })
    }
    if (!funnelStageId) {
      return NextResponse.json(
        { error: "funnelStageId is required" },
        { status: 400 },
      )
    }
    if (!clientId) {
      return NextResponse.json(
        { error: "clientId is required" },
        { status: 400 },
      )
    }
    const result = await createDeal({
      name,
      description,
      funnelStageId,
      clientId,
      contactIds,
      value,
      dealTypeId:
        typeof dealTypeId === "string" && dealTypeId ? dealTypeId : null,
    })
    return NextResponse.json({ success: true, id: result.id })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    // «Настройки стадий»: { stageSettings: [{ id, displayName, isHidden,
    // staleNormDays? }] } — staleNormDays: null / "" = default 14, else 1–365;
    // absent = keep the stored norm.
    if (Array.isArray(body?.stageSettings)) {
      let badNorm = false
      const entries = (body.stageSettings as unknown[]).flatMap((e) => {
        const r = e as {
          id?: unknown
          displayName?: unknown
          isHidden?: unknown
          staleNormDays?: unknown
        }
        if (typeof r?.id !== "string") return []
        const hasNorm = Object.prototype.hasOwnProperty.call(r, "staleNormDays")
        const norm = hasNorm ? parseStaleNormInput(r.staleNormDays) : undefined
        if (hasNorm && norm === undefined) badNorm = true
        return [
          {
            id: r.id,
            displayName:
              typeof r.displayName === "string" ? r.displayName : null,
            isHidden: r.isHidden === true,
            staleNormDays: norm,
          },
        ]
      })
      if (badNorm) {
        return NextResponse.json(
          {
            error: `Норма стадии — целое число дней от ${STALE_NORM_MIN_DAYS} до ${STALE_NORM_MAX_DAYS} (пусто = ${DEFAULT_STALE_NORM_DAYS})`,
          },
          { status: 400 },
        )
      }
      await saveFunnelStageSettings(entries)
      return NextResponse.json({ success: true })
    }
    // Deal types editor (org owner): { dealTypes: [{ id?, code?, labelRu,
    // sort, isHidden }] } — existing rows by id, new rows with a code.
    if (Array.isArray(body?.dealTypes)) {
      const rows = (body.dealTypes as unknown[]).flatMap((e) => {
        const r = e as {
          id?: unknown
          code?: unknown
          labelRu?: unknown
          sort?: unknown
          isHidden?: unknown
        }
        if (typeof r?.labelRu !== "string") return []
        return [
          {
            id: typeof r.id === "string" && r.id ? r.id : undefined,
            code: typeof r.code === "string" ? r.code : undefined,
            labelRu: r.labelRu,
            sort:
              typeof r.sort === "number" && Number.isFinite(r.sort)
                ? Math.round(r.sort)
                : 0,
            isHidden: r.isHidden === true,
          },
        ]
      })
      const types = await saveDealTypeSettings(rows)
      return NextResponse.json({ success: true, types })
    }
    const {
      id,
      statusOnly,
      status,
      moveOnly,
      position,
      name,
      description,
      funnelStageId,
      clientId,
      contactIds,
      value,
      dealTypeId,
    } = body
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 })
    }
    // Deal bridge lifecycle (topics phase 5): { id, action: "pause", until
    // (YYYY-MM-DD), reason } | { id, action: "resume" } | { id, action:
    // "undoAgent", reason? } → the deal engine (journaled).
    if (typeof body.action === "string") {
      if (body.action === "pause") {
        await pauseDealForUser(id, {
          until: typeof body.until === "string" ? body.until : "",
          reason: typeof body.reason === "string" ? body.reason : "",
        })
        return NextResponse.json({ success: true })
      }
      if (body.action === "resume") {
        await resumeDealForUser(id)
        return NextResponse.json({ success: true })
      }
      // Phase 5a: «Обновить» (queue a state run) and «Риск снят» (reason
      // required).
      if (body.action === "refreshState") {
        const { decision, state } = await requestDealStateRefreshForUser(id)
        return NextResponse.json({ success: true, decision, state })
      }
      if (body.action === "clearRisk") {
        if (typeof body.riskId !== "string" || !body.riskId) {
          return NextResponse.json({ error: "Не указан риск" }, { status: 400 })
        }
        const { cleared } = await clearDealRiskForUser(
          id,
          body.riskId,
          typeof body.reason === "string" ? body.reason : "",
        )
        return NextResponse.json({ success: true, cleared })
      }
      if (body.action === "undoAgent") {
        await undoAgentCreatedDeal(
          id,
          typeof body.reason === "string" ? body.reason : null,
        )
        return NextResponse.json({ success: true })
      }
      return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 })
    }
    // Кросс-стадийный перевод через диалог: ставит funnelStageId + заметку-
    // основание (наш путь). `position` (append в целевую колонку) может
    // прийти вместе с note — прокидываем в moveDealStage, чтобы порядок
    // внутри стадии оставался консистентным.
    if (body.move) {
      if (!funnelStageId) {
        return NextResponse.json(
          { error: "funnelStageId is required" },
          { status: 400 },
        )
      }
      await moveDealStage(id, funnelStageId, body.note ?? null, {
        position:
          typeof position === "string" && position.length > 0
            ? position
            : null,
        historyNote: body.historyNote ?? undefined,
      })
      return NextResponse.json({ success: true })
    }
    // `moveOnly` is the kanban drag shortcut: set the target column (funnel
    // stage) + the client-computed fractional-index `position`. Distinct from
    // the full update so a drag never touches name/value/contacts (used for
    // within-column reorder — optimistic, no dialog).
    if (moveOnly) {
      if (!funnelStageId) {
        return NextResponse.json(
          { error: "funnelStageId is required" },
          { status: 400 },
        )
      }
      if (typeof position !== "string" || position.length === 0) {
        return NextResponse.json(
          { error: "position is required" },
          { status: 400 },
        )
      }
      await moveDeal(id, { funnelStageId, position })
      return NextResponse.json({ success: true })
    }
    const isValidStatus = (s: unknown): s is DealStatus =>
      typeof s === "string" &&
      (DEAL_STATUSES as readonly string[]).includes(s)
    // `statusOnly` is the quick cancel / delete / restore shortcut (mirrors
    // tasks' `statusOnly`). Anything else goes through the full update.
    if (statusOnly) {
      if (!isValidStatus(status)) {
        return NextResponse.json(
          { error: "status must be one of: active, cancelled, deleted, paused" },
          { status: 400 },
        )
      }
      await setDealStatus(id, status)
      return NextResponse.json({ success: true })
    }
    if (status !== undefined && !isValidStatus(status)) {
      return NextResponse.json(
        { error: "status must be one of: active, cancelled, deleted, paused" },
        { status: 400 },
      )
    }
    await updateDeal(id, {
      name,
      description,
      funnelStageId,
      clientId,
      contactIds,
      value,
      status,
      // undefined = keep; null / "" = untyped.
      dealTypeId:
        dealTypeId === undefined
          ? undefined
          : typeof dealTypeId === "string" && dealTypeId
            ? dealTypeId
            : null,
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    return errorResponse(error)
  }
}
