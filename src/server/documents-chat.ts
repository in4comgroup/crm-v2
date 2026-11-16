import "server-only"

// Documents for the AI chat (docs/specs/attachments §9): the linked documents
// of a company / contact / deal for its record detail (section «Документы»,
// src/server/chat/records/), as compact `{ name, summary }` rows.
// Org-explicit; read-only.

import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { contact, deal, documentLink, sourceItem } from "@/db/schema"
import { DOCUMENT_ITEM_KINDS } from "@/lib/documents"
import { notDecorativeSql } from "@/server/documents"

export type ChatDocument = { name: string; summary: string | null }
type Ref = { entityType: "client" | "contact" | "deal"; entityId: string }

/**
 * Up to `perEntity` linked documents (links not removed, newest first) per
 * entity, keyed `<entityType>:<entityId>`. A company also gets the documents
 * of its contacts and deals, like the «Документы» view (Q11).
 */
export async function loadEntityDocumentsForChat(
  orgId: string,
  refs: Ref[],
  perEntity = 5,
): Promise<Map<string, ChatDocument[]>> {
  const out = new Map<string, ChatDocument[]>()
  if (refs.length === 0) return out

  // Every ref a view reads: the entity itself + (company) its contacts and deals.
  const clientIds = [...new Set(refs.filter((r) => r.entityType === "client").map((r) => r.entityId))]
  const [cs, ds] = clientIds.length
    ? await Promise.all([
        db
          .select({ id: contact.id, clientId: contact.clientId })
          .from(contact)
          .where(and(eq(contact.organizationId, orgId), inArray(contact.clientId, clientIds))),
        db
          .select({ id: deal.id, clientId: deal.clientId })
          .from(deal)
          .where(and(eq(deal.organizationId, orgId), inArray(deal.clientId, clientIds))),
      ])
    : [[], []]
  const viewOf = new Map<string, string[]>() // ref key → entity keys it reads
  for (const r of refs) viewOf.set(`${r.entityType}:${r.entityId}`, [`${r.entityType}:${r.entityId}`])
  for (const c of cs) if (c.clientId) viewOf.get(`client:${c.clientId}`)?.push(`contact:${c.id}`)
  for (const d of ds) viewOf.get(`client:${d.clientId}`)?.push(`deal:${d.id}`)

  const all = [...new Set([...viewOf.values()].flat())]
  const byType = (t: string) => all.filter((k) => k.startsWith(`${t}:`)).map((k) => k.slice(t.length + 1))
  const conds = (["client", "contact", "deal"] as const)
    .map((t) => ({ t, ids: byType(t) }))
    .filter((x) => x.ids.length > 0)
    .map((x) => and(eq(documentLink.entityType, x.t), inArray(documentLink.entityId, x.ids))!)
  if (conds.length === 0) return out

  const rows = await db
    .select({
      entityType: documentLink.entityType,
      entityId: documentLink.entityId,
      itemId: sourceItem.id,
      name: sourceItem.filename,
      summary: sql<string | null>`${sourceItem.metadataJson}->>'summary'`,
    })
    .from(documentLink)
    .innerJoin(sourceItem, eq(sourceItem.id, documentLink.sourceItemId))
    .where(
      and(
        eq(documentLink.organizationId, orgId),
        isNull(documentLink.removedAt),
        or(...conds),
        inArray(sourceItem.externalType, [...DOCUMENT_ITEM_KINDS] as never),
        notDecorativeSql,
      ),
    )
    .orderBy(desc(sql`coalesce(${sourceItem.sourceCreatedAt}, ${sourceItem.createdAt})`))
    .limit(500)

  const order = new Map(rows.map((r, i) => [r, i]))
  const byEntity = new Map<string, typeof rows>()
  for (const r of rows) {
    const k = `${r.entityType}:${r.entityId}`
    byEntity.set(k, [...(byEntity.get(k) ?? []), r])
  }
  for (const [key, keys] of viewOf) {
    const seen = new Set<string>()
    const docs: ChatDocument[] = []
    // Rows are newest first per entity; merge keeps the global order.
    const merged = keys.flatMap((k) => byEntity.get(k) ?? [])
    merged.sort((a, b) => order.get(a)! - order.get(b)!)
    for (const r of merged) {
      if (seen.has(r.itemId)) continue
      seen.add(r.itemId)
      const summary = r.summary?.trim() ? r.summary.trim().slice(0, 400) : null
      docs.push({ name: r.name ?? "Без названия", summary })
      if (docs.length >= perEntity) break
    }
    if (docs.length > 0) out.set(key, docs)
  }
  return out
}
