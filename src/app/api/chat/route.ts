import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  tool,
  UIMessage,
} from "ai"
import { z } from "zod"
import { pipeJsonRender } from "@json-render/core"
import { buildSystemPrompt } from "@/lib/chat-prompt"
import { getServerSession } from "@/lib/get-session"
import {
  getSourceItemMarkdown,
  listSourceItems,
  type SourceItemRow,
} from "@/server/source-items"
import { listClientContent } from "@/server/client-content"
import { listClients } from "@/server/clients"
import { listContacts } from "@/server/contacts"
import { loadContactCompanyHistoryText } from "@/server/contact-links"
import { listDeals } from "@/server/deals"
import { searchWeb } from "@/server/web-search"
import { getOwnOrgContext } from "@/server/identity/own-org"
import { loadClientProfileTexts } from "@/server/identity/client-profile-context"
import { loadCustomValuesText } from "@/server/custom-fields"
import { loadEntityDocumentsForChat, type ChatDocument } from "@/server/documents-chat"
import { aiStreamText } from "@/server/ai/runtime"
import {
  entitySearchScore,
  FIELD_WEIGHT,
  FUZZY_THRESHOLD,
} from "@/lib/entity-search"

export const maxDuration = 120

// The model comes from the AI process «ИИ чат» (`chat.assistant`): the
// admin's choice on /settings → «Процессы ИИ», or the user's pick from the
// admin-allowed list (docs/specs/models/03-processes-and-model-selection.md).

// Builds the source-search tool set. All three execute server-side and
// are scoped to the caller's active organization — listing only that
// org's items, and refusing to read markdown from rows owned by a
// different org. The chat route is technically public, so the tools
// are only registered when an authenticated session AND an active org
// are both present (enforced by the caller).
// Maps a relevance-matched source_item row to the compact hit shape the
// model reasons over (same shape `searchSourceItems` returns). The model
// reads full bodies via `getSourceItemContent` on a hit's `id`.
function toSourceHit(row: SourceItemRow) {
  const md = (row.metadataJson ?? {}) as Record<string, unknown>
  return {
    id: row.id,
    sourceName: row.sourceName,
    sourceProvider: row.sourceProvider,
    filename: row.filename,
    subject: typeof md.subject === "string" ? md.subject : null,
    snippet: typeof md.snippet === "string" ? md.snippet : null,
    summary: typeof md.summary === "string" ? md.summary : null,
    sourceCreatedAt: row.sourceCreatedAt,
  }
}

// The web half of the engine. `searchWeb` runs its own model call (process
// `chat.web_search`, see src/server/web-search.ts) with the gateway's
// web-search tool, so it works whatever model the chat itself runs on.
// Org + user are passed for attribution of that call.
const buildWebTools = (ai: { orgId: string; userId: string }) => ({
  searchWeb: tool({
    description:
      "Search the public internet and return grounded findings plus the source URLs consulted. Use it for anything the user's own records can't answer — what a company does, who its people are, market/news context, public contact details. Always use it before stating a fact about a named real-world company, person, product or event.",
    inputSchema: z.object({
      query: z
        .string()
        .min(1)
        .describe(
          "What to look up, as a self-contained search query (include the company/person name — this tool sees no chat history).",
        ),
    }),
    execute: async ({ query }) => searchWeb(query, ai),
  }),
})

function buildSourceTools(organizationId: string | null) {
  if (!organizationId) return undefined
  return {
    // ── Unified search (one call, all entity types + sources) ─────────
    // Resolves the user's query into matched clients / contacts / deals
    // and the relevant source items in a single pass, so the chat can
    // render a summary + sectioned result cards from one tool result.
    // The model calls this ONCE, then reads a few source bodies via
    // getSourceItemContent to ground its summary.
    searchEverything: tool({
      description:
        "Search the user's CRM + stored sources in ONE call. Pass the user's query (a company / person / deal name, or any free-text topic). Returns matched clients, contacts, deals and source items (emails, chats, files) plus counts. Call this ONCE per question. Then read the top 1-3 source bodies with getSourceItemContent to ground your summary. The user sees the results rendered as cards — do not enumerate them in prose.",
      inputSchema: z.object({
        query: z
          .string()
          .min(1)
          .describe("What to search for — an entity name or free-text topic."),
        dateFrom: z.iso
          .datetime()
          .optional()
          .describe("Inclusive lower bound on source date (ISO 8601)."),
        dateTo: z.iso
          .datetime()
          .optional()
          .describe("Inclusive upper bound on source date (ISO 8601)."),
      }),
      execute: async ({ query, dateFrom, dateTo }) => {
        const from = dateFrom ? new Date(dateFrom) : undefined
        const to = dateTo ? new Date(dateTo) : undefined

        // Per-section cap. Plenty for a chat result; keeps payloads small.
        const ENTITY_CAP = 12
        const SOURCE_CAP = 15
        // How many matched clients we expand into curated content.
        const CONTENT_CLIENT_CAP = 5

        const [allClients, allContacts, allDeals] = await Promise.all([
          listClients(),
          listContacts(),
          listDeals({ includeCancelled: true }),
        ])

        // Matching goes through `entitySearchScore` — the same normalisation
        // pipeline Search V2 applies to products (Cyrillic→Latin translit,
        // accent-fold, punctuation-insensitive, token-OR, pg_trgm fuzzy gate
        // at FUZZY_THRESHOLD). The old raw `name.toLowerCase().includes(q)`
        // scored 0 whenever the model rephrased the name even slightly —
        // «Норлекс» never found the stored «Norleks», and an em-dash query never
        // found an en-dash name. Results are RANKED so the best match leads.
        //
        // Soft-deleted (`deleted` status) entities are test artifacts /
        // mistakes — hidden from every CRM list by default. They must never
        // surface in search, and a deleted client must not pull in its
        // contacts/deals either (so the deleted-id set is excluded before
        // matchedClientIds is built).
        const rank = <T>(rows: { row: T; score: number }[]) =>
          rows
            .filter((r) => r.score >= FUZZY_THRESHOLD)
            .sort((a, b) => b.score - a.score)
            .map((r) => r.row)

        const matchedClients = rank(
          allClients
            .filter((c) => c.status !== "deleted")
            .map((c) => ({
              row: c,
              score: entitySearchScore(query, [
                { value: c.name, weight: FIELD_WEIGHT.name },
                { value: c.namePhys, weight: FIELD_WEIGHT.alias },
                ...(c.aliases ?? []).map((a) => ({
                  value: a,
                  weight: FIELD_WEIGHT.alias,
                })),
                { value: c.webUrl, weight: FIELD_WEIGHT.secondary },
                { value: c.email, weight: FIELD_WEIGHT.secondary },
              ]),
            })),
        )
        const matchedClientIds = new Set(matchedClients.map((c) => c.id))

        // Contacts: own-name match (technical, native or alias, plus email —
        // an operator often pastes an address) OR belonging to a matched
        // client.
        const matchedContacts = rank(
          allContacts
            .filter((c) => c.status !== "deleted")
            .map((c) => ({
              row: c,
              score:
                c.clientId !== null && matchedClientIds.has(c.clientId)
                  ? 1
                  : entitySearchScore(query, [
                      { value: c.name, weight: FIELD_WEIGHT.name },
                      { value: c.nameNative, weight: FIELD_WEIGHT.name },
                      ...(c.aliases ?? []).map((a) => ({
                        value: a,
                        weight: FIELD_WEIGHT.alias,
                      })),
                      { value: c.email, weight: FIELD_WEIGHT.secondary },
                    ]),
            })),
        )

        // Deals: own name / description match OR belonging to a matched
        // client. `listDeals` already drops `deleted`; the explicit guard
        // keeps it correct if the include flags ever change.
        const matchedDeals = rank(
          allDeals
            .filter((d) => d.status !== "deleted")
            .map((d) => ({
              row: d,
              score: matchedClientIds.has(d.clientId)
                ? 1
                : entitySearchScore(query, [
                    { value: d.name, weight: FIELD_WEIGHT.name },
                    { value: d.clientName, weight: FIELD_WEIGHT.secondary },
                    { value: d.description, weight: FIELD_WEIGHT.weak },
                  ]),
            })),
        )

        // Sources: union of each matched client's curated content + a
        // free-text scan, deduped by id (curated hits win on collision).
        const sourceById = new Map<string, ReturnType<typeof toSourceHit>>()
        const clientContentResults = await Promise.all(
          matchedClients.slice(0, CONTENT_CLIENT_CAP).map((c) =>
            listClientContent({
              organizationId,
              clientId: c.id,
              limit: 8,
              dateFrom: from,
              dateTo: to,
            }).catch(() => ({ rows: [], total: 0, matchTerms: [] })),
          ),
        )
        for (const r of clientContentResults) {
          for (const row of r.rows) {
            if (!sourceById.has(row.id)) sourceById.set(row.id, toSourceHit(row))
          }
        }
        const freeText = await listSourceItems({
          status: "processed",
          organizationId,
          q: query,
          limit: SOURCE_CAP,
          dateFrom: from,
          dateTo: to,
        })
        for (const row of freeText.rows) {
          if (!sourceById.has(row.id)) sourceById.set(row.id, toSourceHit(row))
        }

        // Identity spec I4 (§4.5 «AI chat tools»): the client business
        // profile summary («Профиль клиента») rides along when one exists.
        // Best effort — a failed read never breaks the search.
        const shownClients = matchedClients.slice(0, ENTITY_CAP)
        const shownContacts = matchedContacts.slice(0, ENTITY_CAP)
        // Custom fields (spec clients-contacts Q11): «Название: значение»
        // lines of the SHOWN fields, ≤ 400 chars each. Best effort too.
        const noText = () => new Map<string, string>()
        const shownDeals = matchedDeals.slice(0, ENTITY_CAP)
        const [profiles, clientFields, contactFields, documents, companyHistory] = await Promise.all([
          loadClientProfileTexts(
            organizationId,
            shownClients.map((c) => c.id),
          ).catch((e) => {
            console.error("[chat] client profiles failed", e)
            return new Map<string, { summary: string }>()
          }),
          loadCustomValuesText(
            organizationId,
            "client",
            shownClients.map((c) => c.id),
            400,
          ).catch((e) => {
            console.error("[chat] client custom fields failed", e)
            return noText()
          }),
          loadCustomValuesText(
            organizationId,
            "contact",
            shownContacts.map((c) => c.id),
            400,
          ).catch((e) => {
            console.error("[chat] contact custom fields failed", e)
            return noText()
          }),
          // Documents (spec attachments §9): ≤ 5 linked files per entity
          // (a company also gets its contacts' and deals' files). Best effort.
          loadEntityDocumentsForChat(organizationId, [
            ...shownClients.map((c) => ({ entityType: "client" as const, entityId: c.id })),
            ...shownContacts.map((c) => ({ entityType: "contact" as const, entityId: c.id })),
            ...shownDeals.map((d) => ({ entityType: "deal" as const, entityId: d.id })),
          ]).catch((e) => {
            console.error("[chat] documents failed", e)
            return new Map<string, ChatDocument[]>()
          }),
          // Contact ↔ company links (spec clients-contacts/04 §6): current and
          // former companies of a contact with link history.
          loadContactCompanyHistoryText(
            organizationId,
            shownContacts.map((c) => c.id),
          ).catch((e) => {
            console.error("[chat] contact companies failed", e)
            return noText()
          }),
        ])
        const docsOf = (key: string) => {
          const list = documents.get(key)
          return list?.length ? { documents: list } : {}
        }
        const clients = shownClients.map((c) => {
          const profile = profiles.get(c.id)?.summary ?? ""
          const fields = clientFields.get(c.id) ?? ""
          return {
            id: c.id,
            name: c.name,
            funnelPhase: c.funnelPhase,
            webUrl: c.webUrl,
            email: c.email,
            status: c.status,
            ...(profile ? { profile } : {}),
            ...(fields ? { fields } : {}),
            ...docsOf(`client:${c.id}`),
          }
        })
        const contacts = shownContacts.map((c) => {
          const fields = contactFields.get(c.id) ?? ""
          return {
            id: c.id,
            name: c.name,
            nameNative: c.nameNative,
            email: c.email,
            clientName: c.clientName,
            status: c.status,
            ...(fields ? { fields } : {}),
            ...(companyHistory.get(c.id) ? { companies: companyHistory.get(c.id) } : {}),
            ...docsOf(`contact:${c.id}`),
          }
        })
        const deals = shownDeals.map((d) => ({
          id: d.id,
          name: d.name,
          funnelStageName: d.funnelStageName,
          clientName: d.clientName,
          value: d.value,
          currency: d.currency,
          status: d.status,
          ...docsOf(`deal:${d.id}`),
        }))
        const sources = Array.from(sourceById.values()).slice(0, SOURCE_CAP)

        return {
          query,
          counts: {
            clients: clients.length,
            contacts: contacts.length,
            deals: deals.length,
            sources: sources.length,
          },
          clients,
          contacts,
          deals,
          sources,
        }
      },
    }),
    getSourceItemContent: tool({
      description:
        "Fetch the full parsed markdown for one source item by its id (returned by searchSourceItems). Use this to read content for reasoning so you can ground your prose answer in the real source. The user sees the matched items as cards in the chat with their own preview buttons — you do not need to display the body yourself.",
      inputSchema: z.object({
        sourceItemId: z.string().describe("The source item id."),
      }),
      execute: async ({ sourceItemId }) => {
        const markdown = await getSourceItemMarkdown(sourceItemId, {
          requireOrganizationId: organizationId,
        })
        if (markdown === null) {
          return { ok: false as const, error: "Not parsed or not found." }
        }
        return { ok: true as const, sourceItemId, markdown }
      },
    }),
  } as const
}

export async function POST(req: Request) {
  // Sign-in required, checked before any work: an anonymous caller must never
  // reach the (paid) model or the web-search tool.
  const session = await getServerSession()
  const sourceOrgId = session?.session.activeOrganizationId ?? null
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (!sourceOrgId) {
    return Response.json({ error: "No active organization" }, { status: 403 })
  }

  try {
    const {
      messages,
      model: requestedModelId,
    }: {
      messages: UIMessage[]
      // A model id from GET /api/ai/models?process=chat.assistant. Ids
      // outside the admin-allowed list are ignored by the runtime.
      model?: string
    } = await req.json()

    // ── One universal search engine ───────────────────────────────────
    //
    // There used to be two mutually exclusive toggles ("внутренние
    // источники" / "веб-поиск"), because Google's built-in google_search
    // tool and custom function tools don't coexist on Gemini. Web search is
    // now an ordinary function tool of our own (`searchWeb`), so that
    // conflict is gone: every request gets whichever tools the caller is
    // actually entitled to, and the model picks.
    //
    // Internal tools are tenant-scoped to the caller's active organization
    // (session + org are guaranteed by the check at the top).
    const sourceTools = buildSourceTools(sourceOrgId)

    // Web search is an ordinary function tool, so every provider can call it.
    const tools = {
      ...buildWebTools({ orgId: sourceOrgId, userId: session.user.id }),
      ...(sourceTools ?? {}),
    }
    const hasTools = Object.keys(tools).length > 0

    console.log(
      "[chat] requested model:",
      requestedModelId ?? "-",
      "org:",
      sourceOrgId ?? "-",
      "tools:",
      Object.keys(tools),
    )

    // Identity spec I4: the org's «О нашей компании» card in the system
    // prompt ("" when the org has no profile → prompt unchanged).
    const orgCard = await getOwnOrgContext(sourceOrgId)
      .then((ctx) => ctx.promptCard)
      .catch((e) => {
        console.error("[chat] own-org context failed", e)
        return ""
      })

    const result = await aiStreamText({
      process: "chat.assistant",
      orgId: sourceOrgId,
      userId: session.user.id,
      requestedModelId,
      system: buildSystemPrompt({
        internal: sourceTools !== undefined,
        web: true,
        orgCard,
      }),
      messages: await convertToModelMessages(messages),
      ...(hasTools ? { tools } : {}),
      // Bound the tool-call loop so the model can't spiral. A combined
      // question is the longest chain: searchEverything →
      // getSourceItemContent ×N → google_search → answer.
      stopWhen: stepCountIs(10),
    })

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        writer.merge(pipeJsonRender(result.toUIMessageStream()))
      },
    })

    return createUIMessageStreamResponse({ stream })
  } catch (error) {
    console.error("[chat] Error:", error)
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    )
  }
}
