"use server"

import { db } from "@/db/drizzle"
import { card, client, contact, deal, dealFunnelStage, order } from "@/db/schema"
import { and, desc, eq, inArray, notInArray, or, type SQL } from "drizzle-orm"
import { OPEN_DEAL_STATUSES } from "@/lib/deal-funnel"
import { getServerSession } from "@/lib/get-session"
import { userCardFilter } from "@/server/topics/cards/visibility"
import {
  containsQuery,
  matchesQuery,
  norm,
  normArray,
  normJsonText,
  relevanceOf,
  textQuery,
} from "@/server/search/normalise"

async function requireOrgContext() {
  const session = await getServerSession()
  if (!session) throw new Error("Unauthorized")
  const activeOrgId = session.session.activeOrganizationId
  if (!activeOrgId) throw new Error("No active organization")
  return { activeOrgId }
}

const HITS_PER_ENTITY = 8

// ── Normalised, fuzzy matching (Search V2 pipeline) ─────────────────
//
// This search used to be `ILIKE '%' || q || '%'` on the raw columns: «Норлекс»
// never found the stored «Norleks – Северная Торговая Компания» and an
// em-dash query never found an en-dash name (four of six realistic queries
// returned nothing). The matching helpers now live in
// src/server/search/normalise.ts — ONE definition shared with the AI chat
// records engine (src/server/chat/records/).

export type ClientSearchHit = {
  kind: "client"
  id: string
  name: string
  status: string
  email: string | null
}

export type ContactSearchHit = {
  kind: "contact"
  id: string
  name: string
  clientName: string | null
  email: string | null
}

export type DealSearchHit = {
  kind: "deal"
  id: string
  name: string
  funnelStageName: string
  clientName: string | null
}

export type OrderSearchHit = {
  kind: "order"
  id: string
  orderDate: string
  clientName: string | null
  status: string
}

export type CardSearchHit = {
  kind: "card"
  id: string
  category: string
  priority: string
  analysis: string
  createdAt: string
}

export type GlobalSearchResult = {
  query: string
  clients: ClientSearchHit[]
  contacts: ContactSearchHit[]
  deals: DealSearchHit[]
  orders: OrderSearchHit[]
  cards: CardSearchHit[]
}

const EMPTY_RESULT = (query: string): GlobalSearchResult => ({
  query,
  clients: [],
  contacts: [],
  deals: [],
  orders: [],
  cards: [],
})

export async function searchAcrossEntities(
  rawQuery: string,
): Promise<GlobalSearchResult> {
  const { activeOrgId } = await requireOrgContext()
  const tq = textQuery(rawQuery)
  if (!tq) return EMPTY_RESULT(rawQuery.trim())
  const q = tq.q

  const matches = (expr: SQL): SQL => matchesQuery(tq, expr)
  const relevance = (exprs: SQL[]): SQL => relevanceOf(tq, exprs)

  const clientFields = [
    norm(client.name),
    norm(client.namePhys),
    normArray(client.aliases),
  ]
  const contactFields = [
    norm(contact.name),
    norm(contact.nameNative),
    normArray(contact.aliases),
  ]
  const dealFields = [norm(deal.name), norm(deal.description)]
  // `card.message` is jsonb `{ analysis, recommendation }` — cast to text
  // before normalising, same idiom as source-items.ts's metadata search.
  const cardMessageNorm: SQL = normJsonText(card.message)

  const [clientRows, contactRows, dealRows, orderRows, cardRows] = await Promise.all([
    db
      .select({
        id: client.id,
        name: client.name,
        status: client.status,
        email: client.email,
      })
      .from(client)
      .where(
        and(
          eq(client.organizationId, activeOrgId),
          notInArray(client.status, ["deleted", "blocked"]),
          or(
            ...clientFields.map(matches),
            // Email and phone stay literal: normalising them buys nothing
            // (both are already ASCII) and a fuzzy address match is noise.
            containsQuery(tq, norm(client.email)),
            containsQuery(tq, norm(client.phone)),
          ),
        ),
      )
      .orderBy(desc(relevance(clientFields)), desc(client.updatedAt))
      .limit(HITS_PER_ENTITY),

    db
      .select({
        id: contact.id,
        name: contact.name,
        email: contact.email,
        clientName: client.name,
      })
      .from(contact)
      .leftJoin(client, eq(contact.clientId, client.id))
      .where(
        and(
          eq(contact.organizationId, activeOrgId),
          notInArray(contact.status, ["deleted", "blocked"]),
          or(
            ...contactFields.map(matches),
            containsQuery(tq, norm(contact.email)),
            containsQuery(tq, norm(contact.phone)),
          ),
        ),
      )
      .orderBy(desc(relevance(contactFields)), desc(contact.updatedAt))
      .limit(HITS_PER_ENTITY),

    db
      .select({
        id: deal.id,
        name: deal.name,
        funnelStageName: dealFunnelStage.name,
        clientName: client.name,
      })
      .from(deal)
      .innerJoin(dealFunnelStage, eq(deal.funnelStageId, dealFunnelStage.id))
      .leftJoin(client, eq(deal.clientId, client.id))
      .where(
        and(
          eq(deal.organizationId, activeOrgId),
          inArray(deal.status, [...OPEN_DEAL_STATUSES]),
          or(...dealFields.map(matches)),
        ),
      )
      .orderBy(desc(relevance(dealFields)), desc(deal.updatedAt))
      .limit(HITS_PER_ENTITY),

    // `order` has no name/number field — search matches the order's own
    // description or its client's name. This is a real limitation, not an
    // oversight: there's nothing else human-identifying to match on.
    db
      .select({
        id: order.id,
        orderDate: order.orderDate,
        status: order.status,
        clientName: client.name,
      })
      .from(order)
      .innerJoin(client, eq(order.clientId, client.id))
      .where(
        and(
          eq(order.organizationId, activeOrgId),
          or(matches(norm(order.description)), matches(norm(client.name))),
        ),
      )
      .orderBy(desc(order.orderDate))
      .limit(HITS_PER_ENTITY),

    // Truffalo Cards — the dashboard's own "Поиск в сообщениях" input was
    // removed in favor of this (see cards-feed-section.tsx). Matched via the
    // same normalised/fuzzy `cardMessageNorm` expression as every other
    // entity above, not a raw ILIKE.
    db
      .select({
        id: card.id,
        category: card.category,
        priority: card.priority,
        message: card.message,
        createdAt: card.createdAt,
      })
      .from(card)
      .where(
        and(
          eq(card.organizationId, activeOrgId),
          // Topic (engine) cards only when the org's topics mode is `on`.
          await userCardFilter(activeOrgId),
          matches(cardMessageNorm),
        ),
      )
      .orderBy(desc(relevance([cardMessageNorm])), desc(card.createdAt))
      .limit(HITS_PER_ENTITY),
  ])

  return {
    query: q,
    clients: clientRows.map((r) => ({ kind: "client", ...r })),
    contacts: contactRows.map((r) => ({ kind: "contact", ...r })),
    deals: dealRows.map((r) => ({ kind: "deal", ...r })),
    orders: orderRows.map((r) => ({
      kind: "order",
      id: r.id,
      orderDate:
        r.orderDate instanceof Date
          ? r.orderDate.toISOString()
          : String(r.orderDate),
      clientName: r.clientName,
      status: r.status,
    })),
    cards: cardRows.map((r) => {
      const message = r.message as { analysis?: string } | null
      return {
        kind: "card" as const,
        id: r.id,
        category: r.category,
        priority: r.priority,
        analysis: message?.analysis ?? "",
        createdAt: r.createdAt.toISOString(),
      }
    }),
  }
}
