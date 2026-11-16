import "server-only"

import { sql, type SQL } from "drizzle-orm"
import {
  client,
  deal,
  dealActivity,
  dealFunnelStage,
  dealType,
  product,
  source,
  sourceItem,
  task,
  topic,
  user,
} from "@/db/schema"
import { stageDisplayLabel } from "@/lib/deal-funnel"
import { DOCUMENT_PROVIDER_LABELS_RU } from "@/lib/documents"
import { FAMILY_LABELS_RU } from "@/lib/signals/types"
import { SIGNAL_BAND_LABELS_RU } from "@/lib/signals/extraction-types"
import { TASK_PRIORITY_LABELS, TASK_STATUS_LABELS, TASK_TYPE_LABELS } from "@/lib/task-labels"
import { TOPIC_LIST_LABELS_RU } from "@/lib/topics/attention-types"
import { TOPIC_STATUS_LABELS_RU } from "@/lib/topics/types"
import { getOrgFunnel } from "@/server/deal-engine"
import { caseLabel, type SqlSubject } from "./engine"

// SQL subjects of the chat statistics (spec §8): deals, tasks, sources,
// topics, products. `clients` derives its relationship in JS (clients.ts);
// `orders` runs on the /analytics engine (index.ts). Labels come from the
// lists the UI already uses — never new words.

const orgWhere = (col: SQL | unknown, orgId: string) => sql`${col} = ${orgId}`

// ── Deals ─────────────────────────────────────────────────────────────

const DEAL_OUTCOME = sql`(case
  when ${deal.status} = 'cancelled' then 'cancelled'
  when ${dealFunnelStage.role} = 'won' then 'won'
  when ${dealFunnelStage.role} = 'lost' then 'lost'
  when ${deal.status} = 'paused' then 'paused'
  else 'open' end)`
const DEAL_OUTCOME_LABELS = {
  open: "Открыта",
  won: "Выиграна",
  lost: "Проиграна",
  paused: "Приостановлена",
  cancelled: "Отменена",
}
/** When the deal last moved to a won / lost stage (same rule as the records engine). */
const DEAL_CLOSED_AT = sql`(select max(${dealActivity.createdAt}) from ${dealActivity} inner join ${dealFunnelStage} as closed_stage on closed_stage.id = ${dealActivity.toStageId} where ${dealActivity.dealId} = ${deal.id} and closed_stage.role in ('won', 'lost'))`

export const dealsSubject: SqlSubject = {
  from: () => sql`${deal}
    inner join ${dealFunnelStage} on ${dealFunnelStage.id} = ${deal.funnelStageId}
    left join ${client} on ${client.id} = ${deal.clientId}
    left join ${user} on ${user.id} = ${deal.userId}
    left join ${dealType} on ${dealType.id} = ${deal.dealTypeId}`,
  where: (ctx) => sql`${orgWhere(deal.organizationId, ctx.orgId)} and ${deal.status} <> 'deleted'`,
  dateCol: sql`${deal.createdAt}`,
  measures: {
    count: sql`count(*)`,
    amount: sql`coalesce(sum(${deal.value}), 0)`,
    avgAmount: sql`avg(${deal.value}) filter (where ${deal.value} > 0)`,
    winRate: sql`100.0 * count(*) filter (where ${DEAL_OUTCOME} = 'won') / nullif(count(*) filter (where ${DEAL_OUTCOME} in ('won', 'lost')), 0)`,
    avgDaysToClose: sql`avg(extract(epoch from (${DEAL_CLOSED_AT} - ${deal.createdAt})) / 86400.0) filter (where ${DEAL_OUTCOME} in ('won', 'lost'))`,
  },
  dimensions: {
    stage: {
      key: sql`${dealFunnelStage.id}`,
      label: sql`coalesce(nullif(trim(${dealFunnelStage.displayName}), ''), ${dealFunnelStage.name})`,
      // System stage names are English; the board shows them in Russian.
      labelOf: (_k, l) => stageDisplayLabel(l, null),
      // Stage by the label the user sees, its name or its code.
      filter: async (ctx, value) => {
        const v = value.trim().toLowerCase()
        const ids = (await getOrgFunnel(ctx.orgId))
          .filter((s) =>
            [stageDisplayLabel(s.name, s.displayName), s.name, s.code ?? ""].some((x) => x.trim().toLowerCase() === v),
          )
          .map((s) => s.id)
        return ids.length ? sql`${dealFunnelStage.id} in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})` : sql`false`
      },
    },
    outcome: { key: DEAL_OUTCOME, label: caseLabel(DEAL_OUTCOME, DEAL_OUTCOME_LABELS) },
    owner: { key: sql`${deal.userId}`, label: sql`${user.name}` },
    type: { key: sql`${dealType.code}`, label: sql`${dealType.labelRu}` },
    client: { key: sql`${client.id}`, label: sql`${client.name}` },
    outcomeReason: {
      key: sql`nullif(coalesce(${deal.outcomeReasonCode}, ${deal.outcomeReason}), '')`,
      label: sql`coalesce(nullif(${deal.outcomeReason}, ''), ${deal.outcomeReasonCode})`,
    },
  },
}

// ── Tasks ─────────────────────────────────────────────────────────────

const TASK_OPEN = sql`${task.status} in ('todo', 'in_progress')`

export const tasksSubject: SqlSubject = {
  from: () => sql`${task}
    left join ${client} on ${client.id} = ${task.clientId}
    left join ${user} on ${user.id} = ${task.assigneeId}`,
  where: (ctx) => orgWhere(task.organizationId, ctx.orgId),
  dateCol: sql`${task.dueDate}`,
  measures: {
    count: sql`count(*)`,
    open: sql`count(*) filter (where ${TASK_OPEN})`,
    overdue: sql`count(*) filter (where ${TASK_OPEN} and ${task.dueDate} < now())`,
    done: sql`count(*) filter (where ${task.status} = 'done')`,
  },
  dimensions: {
    status: { key: sql`${task.status}`, label: caseLabel(sql`${task.status}`, TASK_STATUS_LABELS) },
    assignee: { key: sql`${task.assigneeId}`, label: sql`${user.name}` },
    type: { key: sql`${task.type}`, label: caseLabel(sql`${task.type}`, TASK_TYPE_LABELS) },
    priority: { key: sql`${task.priority}`, label: caseLabel(sql`${task.priority}`, TASK_PRIORITY_LABELS) },
    client: { key: sql`${client.id}`, label: sql`${client.name}` },
  },
}

// ── Sources ───────────────────────────────────────────────────────────

const PROVIDER_GROUP = sql`(case ${source.provider}::text
  when 'nylas' then 'mail' when 'imap' then 'mail'
  when 'gdrive' then 'drive' when 'dropoff' then 'files'
  else ${source.provider}::text end)`
const PROVIDER_GROUP_LABELS = {
  mail: "Почта",
  telegram: DOCUMENT_PROVIDER_LABELS_RU.telegram,
  whatsapp: DOCUMENT_PROVIDER_LABELS_RU.whatsapp,
  gchat: DOCUMENT_PROVIDER_LABELS_RU.gchat,
  drive: DOCUMENT_PROVIDER_LABELS_RU.gdrive,
  files: DOCUMENT_PROVIDER_LABELS_RU.dropoff,
  aichat: DOCUMENT_PROVIDER_LABELS_RU.aichat,
}
/** Own-org attribution → direction (same rule as the records engine's filter). */
const DIRECTION = sql`(case
  when ${sourceItem.orgAttribution} = 'external' then 'in'
  when ${sourceItem.orgAttribution} = 'own_org' and coalesce((${sourceItem.metadataJson}->'orgAttribution'->>'allInternal') = 'true', false) then 'internal'
  when ${sourceItem.orgAttribution} = 'own_org' then 'out'
  else null end)`
const ITEM_KIND = sql`(case when ${sourceItem.parentSourceItemId} is null and ${sourceItem.externalType}::text in ('email', 'chat_message', 'aichat_session') then 'message' else 'document' end)`

export const sourcesSubject: SqlSubject = {
  from: () => sql`${sourceItem} inner join ${source} on ${source.id} = ${sourceItem.sourceId}`,
  where: (ctx) => sql`${orgWhere(sourceItem.organizationId, ctx.orgId)} and ${sourceItem.parseStatus} <> 'skipped'`,
  dateCol: sql`coalesce(${sourceItem.sourceCreatedAt}, ${sourceItem.createdAt})`,
  measures: { count: sql`count(*)` },
  dimensions: {
    provider: { key: PROVIDER_GROUP, label: caseLabel(PROVIDER_GROUP, PROVIDER_GROUP_LABELS) },
    source: { key: sql`${source.id}`, label: sql`${source.name}` },
    direction: { key: DIRECTION, label: caseLabel(DIRECTION, { in: "Входящие", out: "Исходящие", internal: "Внутренние" }) },
    kind: { key: ITEM_KIND, label: caseLabel(ITEM_KIND, { message: "Сообщения", document: "Документы и файлы" }) },
  },
}

// ── Topics (topics mode `on` only — gated in index.ts) ───────────────

export const topicsSubject: SqlSubject = {
  from: () => sql`${topic}
    left join ${client} on ${client.id} = ${topic.clientId}
    left join ${user} on ${user.id} = ${topic.ownerUserId}`,
  where: (ctx) => sql`${orgWhere(topic.organizationId, ctx.orgId)} and ${topic.status} <> 'merged'`,
  dateCol: sql`${topic.firstSeenAt}`,
  measures: {
    count: sql`count(*)`,
    open: sql`count(*) filter (where ${topic.status} in ('open', 'dormant'))`,
    resolved: sql`count(*) filter (where ${topic.status} in ('resolved', 'done'))`,
    avgDaysToClose: sql`avg(extract(epoch from (${topic.closedAt} - ${topic.firstSeenAt})) / 86400.0) filter (where ${topic.closedAt} is not null)`,
  },
  dimensions: {
    status: { key: sql`${topic.status}`, label: caseLabel(sql`${topic.status}`, TOPIC_STATUS_LABELS_RU) },
    // `none` reads «Все темы» on the dashboard tab; in a breakdown it means «not in a list».
    list: { key: sql`${topic.list}`, label: caseLabel(sql`${topic.list}`, { ...TOPIC_LIST_LABELS_RU, none: "Вне списков" }) },
    band: { key: sql`${topic.band}`, label: caseLabel(sql`${topic.band}`, SIGNAL_BAND_LABELS_RU) },
    family: { key: sql`${topic.family}`, label: caseLabel(sql`${topic.family}`, FAMILY_LABELS_RU) },
    client: { key: sql`${client.id}`, label: sql`${client.name}` },
    owner: { key: sql`${topic.ownerUserId}`, label: sql`${user.name}` },
  },
}

// ── Products (catalog; no date) ───────────────────────────────────────

const attr = (k: string) => sql`nullif(trim(${product.additionalMetadata}->>${k}), '')`

export const productsSubject: SqlSubject = {
  from: () => sql`${product}`,
  where: (ctx) => sql`${orgWhere(product.organizationId, ctx.orgId)} and ${product.status} = 'active'`,
  dateCol: null,
  measures: {
    count: sql`count(*)`,
    inStock: sql`count(*) filter (where ${product.totalStock} > 0)`,
    totalStock: sql`coalesce(sum(greatest(${product.totalStock}, 0)), 0)`,
    avgPrice: sql`avg(${product.price}) filter (where ${product.price} > 0)`,
  },
  dimensions: {
    category: { key: sql`nullif(trim(${product.category}), '')`, label: sql`nullif(trim(${product.category}), '')` },
    country: { key: attr("country_name"), label: attr("country_name") },
    region: { key: attr("region"), label: attr("region") },
    color: { key: attr("color"), label: attr("color") },
    type: { key: attr("type"), label: attr("type") },
  },
}
