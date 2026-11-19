import "server-only"

// Web lookup of a company (grounded web search + structured extract) and the
// enrichment flows built on it — ORG-EXPLICIT core, no session (rule 5), so
// background callers (enrichment on create, identity spec I6 / Q6) can run it
// after the request. The session-bound wrappers stay in src/server/clients.ts
// (`lookupClientOnWeb`, `enrichClientFromWeb`, `resolveEnrichment`) and in
// src/server/identity/client-profile.ts («Заполнить из интернета»).
//
// The extract step returns the contact fields (unchanged behaviour) AND, per
// candidate, the client business profile fields of spec §4.3 (description,
// industry code, market roles, products / services, size band, geography —
// each with a confidence and a source URL). Profile values are written only
// through the apply rule (`applyWebProfileToClient`, never overwrites).

import { and, eq } from "drizzle-orm"
import { after } from "next/server"
import { request as httpsRequest } from "node:https"
import { request as httpRequest } from "node:http"
import { Output, isStepCount } from "ai"
import { z } from "zod"
import { db } from "@/db/drizzle"
import { client, clientProfile, contact, member } from "@/db/schema"
import { aiGenerateText } from "@/server/ai/runtime"
import { getOrgBudgetStatus } from "@/server/ai/budget"
import { getOrgSetting, setOrgSetting } from "@/server/org-settings"
import { MARKET_ROLES, MARKET_ROLE_LABELS_RU } from "@/lib/identity/org-profile"
import {
  CLIENT_SIZE_BANDS,
  CLIENT_SIZE_LABELS_RU,
  type ClientProfileField,
} from "@/lib/identity/client-profile"
import { normalizeWebProfile, webRefreshDue, type RawWebProfile } from "@/lib/identity/client-profile-apply"
import {
  ClientProfileError,
  applyWebProfileToClient,
  assertCanEditClientProfile,
} from "@/server/identity/client-profile"
import { listIndustries, type IndustryOption } from "@/server/identity/org-profile"

// ── Web lookup (grounded web search + structured extract) ────────────
//
// Two AI processes: `clients.enrichment_research` (web_search capability)
// and `clients.enrichment_extract` (structured output). Models are picked
// by the AI runtime (src/server/ai/), not here.

// ── Direct homepage fetch (precision booster for the extract pass) ────
//
// Grounded web search returns snippets, not full page bodies — so an
// address sitting in a homepage footer / Impressum frequently never reaches
// the model. When we already know the company's own URL, we additionally
// fetch the homepage + a few likely contact/legal pages and feed the raw
// text straight into the structured-extract pass as primary-source evidence.
const FETCH_TIMEOUT_MS = 8000 // per page
const MAX_EXTRA_PAGES = 4 // contact/impressum/about pages beyond the homepage
const MAX_REDIRECTS = 3
// Raw-HTML cap. Deliberately generous: a Tilda-style one-pager weighs ~1 MB of
// markup but strips down to ~5 KB of text, and the footer — where the phone and
// the address live — is the LAST thing in the file. The previous 400 KB cap cut
// it off silently, which is why site-published phones never reached the model.
const MAX_PAGE_BYTES = 3_000_000
const MAX_PAGE_TEXT = 6_000 // per-page text budget (head + footer sample)
const MAX_SITE_TEXT = 16_000 // cap the combined text handed to the LLM
// A real browser UA. Anti-DDoS front-ends (DDoS-Guard, Qrator) answer a bot UA
// with 403 on every sub-page — example.org/about does exactly that.
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
// Anchors whose href or label hint at where an address usually lives.
const ADDRESS_PAGE_HINT =
  /(contact|kontakt|contacto|contatti|impressum|imprint|about|legal|mentions[-\s]?l[eé]gales|company|firma|standort|location|контакт|адрес|реквизит|о[-\s]?нас|о[-\s]?компании|kontakty|rekvizity|o-kompanii|o-nas)/i
// Fallback guesses used only when the homepage exposes no hinted links.
const ADDRESS_PAGE_GUESSES = [
  "/contacts",
  "/contact",
  "/kontakty",
  "/kontakt",
  "/about",
  "/o-kompanii",
  "/impressum",
]

/**
 * Accept whatever a human types into the "Сайт" field. A scheme-less
 * "example.org" made `new URL()` throw, which silently disabled the whole
 * own-site fetch and left the URL-pinned research branch chasing a bare
 * hostname. Returns "" when there is nothing usable.
 */
function normalizeSiteUrl(raw: string | null | undefined): string {
  const trimmed = (raw ?? "").trim()
  if (!trimmed) return ""
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`
  try {
    const u = new URL(withScheme)
    if (!u.hostname.includes(".")) return ""
    return u.toString().replace(/\/$/, "")
  } catch {
    return ""
  }
}

// Minimal HTML → text: drop non-content tags, turn block boundaries into
// newlines, decode the handful of entities that matter, collapse whitespace.
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|footer|header|address)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t ]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

// Keep a page's text inside budget WITHOUT losing the footer — that is where
// the address and the phone usually sit, so a plain head-slice throws away the
// very thing we came for. Sample the head and the tail instead.
function clampPageText(text: string): string {
  if (text.length <= MAX_PAGE_TEXT) return text
  const head = text.slice(0, Math.floor(MAX_PAGE_TEXT * 0.55))
  const tail = text.slice(-Math.floor(MAX_PAGE_TEXT * 0.45))
  return `${head}\n…(middle omitted)…\n${tail}`
}

// Fetch one page → capped raw HTML, or "" on any failure (never throws).
//
// Uses node:https directly instead of global fetch for ONE reason: anti-DDoS
// front-ends (example.org sits behind DDoS-Guard) hand a self-signed
// certificate to non-browser clients, so `fetch` dies with
// DEPTH_ZERO_SELF_SIGNED_CERT before a single byte is read. These are public
// marketing pages and we send no credentials with the request, so a relaxed
// certificate check is the difference between reading the company's own site
// and guessing from third-party news articles.
function fetchPageRaw(url: string, depth = 0): Promise<string> {
  return new Promise((resolve) => {
    let target: URL
    try {
      target = new URL(url)
    } catch {
      return resolve("")
    }
    if (target.protocol !== "https:" && target.protocol !== "http:") {
      return resolve("")
    }
    const secure = target.protocol === "https:"
    const req = (secure ? httpsRequest : httpRequest)(
      {
        hostname: target.hostname,
        port: target.port || undefined,
        path: `${target.pathname}${target.search}`,
        method: "GET",
        ...(secure
          ? { rejectUnauthorized: false, servername: target.hostname }
          : {}),
        headers: {
          "user-agent": BROWSER_UA,
          accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "ru-RU,ru;q=0.9,en;q=0.8",
          // No gzip — we would have to inflate it ourselves here.
          "accept-encoding": "identity",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0
        const location = res.headers.location
        if (status >= 300 && status < 400 && location && depth < MAX_REDIRECTS) {
          res.resume()
          let next: string
          try {
            next = new URL(location, target).toString()
          } catch {
            return resolve("")
          }
          return resolve(fetchPageRaw(next, depth + 1))
        }
        if (status !== 200) {
          res.resume()
          return resolve("")
        }
        const ct = String(res.headers["content-type"] ?? "")
        if (ct && !ct.includes("html") && !ct.includes("xml")) {
          res.resume()
          return resolve("")
        }
        let body = ""
        res.setEncoding("utf8")
        res.on("data", (chunk: string) => {
          body += chunk
          if (body.length > MAX_PAGE_BYTES) {
            body = body.slice(0, MAX_PAGE_BYTES)
            res.destroy()
          }
        })
        res.on("close", () => resolve(body))
        res.on("error", () => resolve(body))
      },
    )
    req.on("error", () => resolve(""))
    req.setTimeout(FETCH_TIMEOUT_MS, () => {
      req.destroy()
      resolve("")
    })
    req.end()
  })
}

// Same-site anchors (homepage host or a sub/parent of it) whose href/label
// hint at an address-bearing page. Deduped, capped.
function findAddressPageLinks(homeHtml: string, base: URL): string[] {
  const baseHost = base.hostname
  const sameSite = (h: string) =>
    h === baseHost || h.endsWith("." + baseHost) || baseHost.endsWith("." + h)
  const out = new Set<string>()
  const re = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(homeHtml)) && out.size < MAX_EXTRA_PAGES * 4) {
    const href = m[1]
    const label = m[2].replace(/<[^>]+>/g, " ")
    if (!ADDRESS_PAGE_HINT.test(href) && !ADDRESS_PAGE_HINT.test(label)) continue
    try {
      const abs = new URL(href, base)
      abs.hash = ""
      if (sameSite(abs.hostname) && abs.toString() !== base.toString()) {
        out.add(abs.toString())
      }
    } catch {
      /* skip unparseable href */
    }
  }
  return [...out].slice(0, MAX_EXTRA_PAGES)
}

/**
 * Fetch the company's own site (homepage + up to {@link MAX_EXTRA_PAGES}
 * hinted contact/legal pages) and return a single labelled text blob for the
 * extract pass. Best-effort: returns "" if the homepage can't be fetched.
 */
async function fetchSiteTextForLookup(knownUrl: string): Promise<string> {
  const normalized = normalizeSiteUrl(knownUrl)
  if (!normalized) return ""
  let base: URL
  try {
    base = new URL(normalized)
  } catch {
    return ""
  }

  let homeRaw = await fetchPageRaw(base.toString())
  // Some older RU corporate sites still answer on http only.
  if (!homeRaw && base.protocol === "https:") {
    const plain = new URL(base.toString())
    plain.protocol = "http:"
    homeRaw = await fetchPageRaw(plain.toString())
    if (homeRaw) base = plain
  }
  if (!homeRaw) return ""

  let links = findAddressPageLinks(homeRaw, base)
  // No hinted links on the homepage → try a few well-known paths.
  if (links.length === 0) {
    links = ADDRESS_PAGE_GUESSES.slice(0, MAX_EXTRA_PAGES).map((p) =>
      new URL(p, base).toString(),
    )
  }

  const extraRaws = await Promise.all(links.map((u) => fetchPageRaw(u)))

  const sections = [
    `# ${base.toString()}\n${clampPageText(htmlToText(homeRaw))}`,
  ]
  links.forEach((u, i) => {
    const t = clampPageText(htmlToText(extraRaws[i] || ""))
    if (t) sections.push(`# ${u}\n${t}`)
  })

  let combined = sections.join("\n\n----\n\n")
  if (combined.length > MAX_SITE_TEXT) {
    combined = combined.slice(0, MAX_SITE_TEXT) + "\n…(truncated)"
  }
  return combined
}

export type ClientLookupCandidate = {
  name: string
  email: string
  phone: string
  address: string
  webUrl: string
  confidence: "high" | "medium" | "low"
  whyMatch: string
  /**
   * Business profile of this candidate (identity I6, spec §4.3), raw as the
   * extract model returned it — validated by `normalizeWebProfile` before any
   * write. Optional: candidates parked before I6 do not have it.
   */
  profile?: RawWebProfile
}

export type ClientLookupSource = {
  url: string
  title: string
}

export type ClientLookupResult = {
  candidates: ClientLookupCandidate[]
  sources: ClientLookupSource[]
  /** Free-text caveat from the model — empty when there's nothing to flag. */
  notes: string
}

/**
 * Operator-typed search parameters. The stored client row is only a starting
 * point: whatever the user types in the lookup dialog overrides it for THIS
 * search (nothing is written to the DB until they press save). A `webUrl` hint
 * also switches the research on to the URL-pinned branch, which is the single
 * most effective way to stop name-similarity matches in another country.
 */
export type ClientLookupHints = {
  name?: string | null
  email?: string | null
  phone?: string | null
  address?: string | null
  webUrl?: string | null
}

// Per-field profile output (identity I6). Every part carries its own
// confidence + the URL it came from; empty value / empty list = not found.
// Codes are validated in code afterwards (`normalizeWebProfile`).
const confidenceField = z
  .enum(["high", "medium", "low"])
  .describe(
    "high = stated on the company's own website or an official record; medium = a reliable third-party source; low = a guess from indirect hints.",
  )
const sourceUrlField = z
  .string()
  .describe("The URL the value was taken from (one of the research sources). Empty string if none.")

const profileExtractSchema = z
  .object({
    description: z.object({
      value: z
        .string()
        .describe(
          "What the company does, 1–3 sentences in Russian, ≤ 500 characters, neutral and factual (no advertising language). Empty string if unknown.",
        ),
      confidence: confidenceField,
      sourceUrl: sourceUrlField,
    }),
    industry: z.object({
      code: z
        .string()
        .describe("ONE industry code from the list in the prompt. Empty string if none fits or it is unknown."),
      note: z.string().describe("Optional short Russian clarification of the industry, ≤ 200 characters. Empty string if none."),
      confidence: confidenceField,
      sourceUrl: sourceUrlField,
    }),
    marketRoles: z.object({
      values: z
        .array(z.string())
        .describe("Market role codes from the list in the prompt (one or more). Empty list if unknown."),
      confidence: confidenceField,
      sourceUrl: sourceUrlField,
    }),
    products: z.object({
      names: z
        .array(z.string())
        .max(15)
        .describe("Up to 15 short names of the company's OWN main products / services (Russian or as written). Empty list if unknown."),
      confidence: confidenceField,
      sourceUrl: sourceUrlField,
    }),
    size: z.object({
      band: z.string().describe("ONE size code from the list in the prompt. Empty string if unknown."),
      pointsOfSale: z
        .number()
        .describe("Number of stores / points of sale / branches when the company is a chain; 0 if unknown or not a chain."),
      confidence: confidenceField,
      sourceUrl: sourceUrlField,
    }),
    geography: z.object({
      value: z
        .string()
        .describe("Where the company works (regions / countries / cities), Russian, ≤ 200 characters. Empty string if unknown."),
      confidence: confidenceField,
      sourceUrl: sourceUrlField,
    }),
  })
  .describe(
    "Business profile of THIS candidate. Never invent: only what the research notes or the website text confirm; empty values otherwise.",
  )

const lookupExtractSchema = z.object({
  candidates: z
    .array(
      z.object({
        name: z
          .string()
          .describe(
            "Canonical company name as listed on its own website / official records.",
          ),
        email: z
          .string()
          .describe(
            "Primary contact email (info@, contact@, hello@, sales@). Empty string if not found.",
          ),
        phone: z
          .string()
          .describe(
            "Primary main-office phone, in international format with the country code, exactly as the company publishes it. Do not guess the country code — take it from the source. Empty string if not found.",
          ),
        address: z
          .string()
          .describe(
            "Main / headquarters office street address as a single line, e.g. 'street, city, postcode, country'. Return whatever parts you can confirm even if incomplete (e.g. just city + country). Empty string ONLY if no address at all is found.",
          ),
        webUrl: z
          .string()
          .describe(
            "Canonical https://… homepage URL (no trailing slash). Empty string if not found.",
          ),
        confidence: z
          .enum(["high", "medium", "low"])
          .describe(
            "How confidently this candidate matches the input client. high = address or contact email matches; medium = same industry / region; low = name match only.",
          ),
        whyMatch: z
          .string()
          .describe(
            "One short sentence explaining why this is a candidate (e.g. 'Address matches the stored head-office address'). Used to disambiguate between candidates.",
          ),
        profile: profileExtractSchema,
      }),
    )
    .max(3)
    .describe(
      "Up to 3 candidate companies that could match the input. Sort best match first. If the research clearly identifies one company, return one element.",
    ),
  notes: z
    .string()
    .describe(
      "Caveats about the search (e.g. 'Two unrelated companies share this name in different countries'). Empty string when nothing to flag.",
    ),
})

const PROFILE_RESEARCH_ITEMS =
  "what the company does, its industry, its role in the market (manufacturer, importer, distributor / wholesaler, retail, online store, agency, services, IT / software), its own main products or services, its size (staff, number of stores / branches) and where it operates"

/** The profile part of the extract prompt: the allowed codes with labels. */
function profileInstructions(industries: IndustryOption[]): string {
  const ind = industries.map((i) => `${i.code} = ${i.label}`).join("; ")
  const roles = MARKET_ROLES.map((r) => `${r} = ${MARKET_ROLE_LABELS_RU[r]}`).join("; ")
  const sizes = CLIENT_SIZE_BANDS.map((b) => `${b} = ${CLIENT_SIZE_LABELS_RU[b]}`).join("; ")
  return `Also fill "profile" for each candidate — what THIS company itself does (not what it buys, not its partners):
- description: 1–3 neutral sentences in Russian.
- industry.code: exactly one of these codes (or empty): ${ind}.
- marketRoles.values: codes from: ${roles}.
- products.names: up to 15 of its own main products / services.
- size.band: one of: ${sizes} (micro < 15 staff, small < 100, medium < 250, large ≥ 250; chain = a network of stores / branches, then also pointsOfSale).
- geography: regions / countries / cities where it works.
Each part has its own confidence and sourceUrl (the page it came from). Leave a part empty when the sources do not state it — never guess.`
}

/** Tenant check: the client row of `orgId` (same error texts as the session wrapper). */
async function loadClientInOrg(orgId: string, clientId: string) {
  const rows = await db.select().from(client).where(eq(client.id, clientId)).limit(1)
  const row = rows[0]
  if (!row) throw new Error("Client not found")
  if (row.organizationId !== orgId) throw new Error("Unauthorized")
  return row
}

/**
 * Run a web lookup for the given client. Two-pass:
 *
 *   1. RESEARCH — process `clients.enrichment_research` with the web
 *      search tool (capability `web_search`).
 *      The model writes a short freeform research note about the company
 *      using whatever it learns from the web. We capture the grounded
 *      sources (URL + title) the model used.
 *
 *   2. EXTRACT — process `clients.enrichment_extract`, structured output but
 *      no tools, feeding it the research note + the input client's
 *      current fields. Returns up to 3 candidate matches.
 *
 * Two passes (rather than one with tools+structured-output combined)
 * keeps each call inside a known-good AI SDK shape — combining tools
 * with structured output is brittle across providers / SDK versions.
 *
 * NO writes. The lookup dialog applies what the user picks via PUT
 * /api/clients; the enrichment flows below apply the contact fields
 * fill-blanks-only and the profile through `applyWebProfileToClient`.
 * Org-explicit: `orgId` is the tenant (the client must belong to it, else
 * "Unauthorized" / "Client not found" like the session wrapper), `userId` is
 * null for background calls.
 *
 * `hints` are the operator's own search parameters (see {@link
 * ClientLookupHints}): they override the stored row when the prompt is built,
 * and are passed to the model as authoritative constraints. Omitted → the
 * search runs off the stored record alone, as the batch enrichment does.
 */
export async function lookupClientOnWebForOrg(
  orgId: string,
  userId: string | null,
  clientId: string,
  hints?: ClientLookupHints,
): Promise<ClientLookupResult> {
  const target = await loadClientInOrg(orgId, clientId)
  const aiCtx = { orgId, userId, ref: { clientId } }
  const industries = await listIndustries()

  // Pull active contacts for extra disambiguation context (their names +
  // emails — never the suspended ones, those are archived).
  const contacts = await db
    .select({
      name: contact.name,
      email: contact.email,
      position: contact.position,
    })
    .from(contact)
    .where(
      and(
        eq(contact.organizationId, orgId),
        eq(contact.clientId, clientId),
        eq(contact.status, "active"),
      ),
    )

  // Operator hints win over the stored row for this one search. `given` marks
  // the fields the operator typed by hand — those go into the prompt a second
  // time as hard constraints, because "the company we mean is the one in
  // Springfield" is exactly the information that stops a .com namesake winning.
  const hint = (v?: string | null) => (v ?? "").trim()
  const given = {
    name: hint(hints?.name),
    email: hint(hints?.email),
    phone: hint(hints?.phone),
    address: hint(hints?.address),
    webUrl: normalizeSiteUrl(hints?.webUrl),
  }
  const effective = {
    name: given.name || target.name,
    email: given.email || (target.email ?? "").trim(),
    phone: given.phone || (target.phone ?? "").trim(),
    address: given.address || (target.address ?? "").trim(),
    webUrl: given.webUrl || normalizeSiteUrl(target.webUrl),
  }

  const knownLines = [
    `Name: ${effective.name}`,
    effective.email ? `Email: ${effective.email}` : null,
    effective.phone ? `Phone: ${effective.phone}` : null,
    effective.address ? `Address: ${effective.address}` : null,
    effective.webUrl ? `Website: ${effective.webUrl}` : null,
    contacts.length > 0
      ? `Known contacts: ${contacts
          .map((c) => {
            const tail = [c.position, c.email].filter(Boolean).join(", ")
            return tail ? `${c.name} (${tail})` : c.name
          })
          .join("; ")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n")

  const constraintLines = [
    given.name ? `- Company name: "${given.name}" — this is the entity meant.` : null,
    given.webUrl
      ? `- Official website: ${given.webUrl} — the company behind THIS domain, no other.`
      : null,
    given.address
      ? `- Office / location: ${given.address} — reject any candidate in another city or country.`
      : null,
    given.phone ? `- Known phone: ${given.phone}` : null,
    given.email ? `- Known email: ${given.email}` : null,
  ].filter(Boolean)
  const constraints =
    constraintLines.length > 0
      ? `

Operator-confirmed parameters. These come from the CRM user, who knows this client — they are authoritative. Any candidate that contradicts them is the wrong company:
${constraintLines.join("\n")}`
      : ""

  // A known website URL is the authoritative identity of the company: when
  // it's present we pin all research to that one site and never offer
  // name-similarity alternatives (the URL, not the name, is the key criterion).
  const knownUrl = effective.webUrl
  const hasKnownUrl = knownUrl.length > 0

  // ── Pass 1: grounded research ───────────────────────────────────────
  const researchPrompt = hasKnownUrl
    ? `I have the following CRM record for a company:

${knownLines}${constraints}

This record already has a confirmed official website: ${knownUrl}

Research ONLY this exact organisation — the one that owns ${knownUrl}. Use web search to read that website (and pages directly under that same domain) to gather: official company name, primary contact email, main-office phone, headquarters address, and the business profile (${PROFILE_RESEARCH_ITEMS}). The website URL is the authoritative identity of this company.

Do NOT consider, search for, or mention any other company that merely has a similar name — only the organisation behind ${knownUrl} matters here. Contact details published on ${knownUrl} itself outrank anything a news site, directory or aggregator says. Search in the language of that website as well as in English.

Write 1–3 short paragraphs of research notes summarising what you found on that website. State for each detail where it came from. Do NOT fabricate facts — only state what your search results actually confirm.`
    : `I have the following CRM record for a company:

${knownLines}${constraints}

Use web search to research this company. Identify the most likely real-world organisation (or organisations, if the name is ambiguous). For each candidate, gather: official company name, primary contact email, main-office phone, headquarters address, official website URL, and the business profile (${PROFILE_RESEARCH_ITEMS}).

Search in the local language of the operator-confirmed location as well as in English — the company's own local-language site is a better source than an English directory.

Write 2–4 short paragraphs of research notes summarising what you found. If multiple companies share this name, note them separately, and say which one fits the operator-confirmed parameters. Do NOT fabricate facts — only state what your search results actually confirm.`

  // When we know the company's own URL, fetch its actual page text in
  // parallel with the grounded research — grounding only sees snippets, so
  // this is what reliably surfaces footer / Impressum addresses.
  const sitePromise = hasKnownUrl
    ? fetchSiteTextForLookup(knownUrl)
    : Promise.resolve("")

  const research = await aiGenerateText({
    process: "clients.enrichment_research",
    ...aiCtx,
    capabilities: ["web_search"],
    instructions:
      "You are a precise company-research assistant. Use the web search tool to find authoritative information about the given company. Prefer official websites, LinkedIn company pages, and corporate registries over social media or aggregators. Never invent details — if a field can't be confirmed by the search results, say so explicitly.",
    prompt: researchPrompt,
    // Bound the search → fetch → answer loop so the model can't spiral.
    stopWhen: isStepCount(5),
    // Same input must give the same answer: two runs of this lookup used to
    // return a different address and drop the phone entirely.
    temperature: 0,
  })

  const siteText = await sitePromise

  // Grounded search exposes the URLs it consulted on `result.sources`.
  // The Source union has both 'url' and 'document' variants — narrow to
  // url before we read .url / .title.
  const sources: ClientLookupSource[] = (research.sources ?? []).flatMap(
    (s) =>
      s.sourceType === "url"
        ? [{ url: s.url, title: s.title ?? s.url }]
        : [],
  )

  // ── Pass 2: structured extraction ───────────────────────────────────
  const extractPrompt = hasKnownUrl
    ? `CRM record (current fields):
${knownLines}${constraints}

Research notes from web search (about ${knownUrl} only):
${research.text || "(no research output)"}
${
  siteText
    ? `
Raw text fetched directly from the company's own website (${knownUrl} and its contact / legal pages). This is PRIMARY-SOURCE evidence — prefer it over the research notes for address, phone, and email. The headquarters address is usually in the page footer or on an Impressum / legal-notice / contact page:
"""
${siteText}
"""
`
    : ""
}
The record's website URL (${knownUrl}) is the authoritative identity of this company. Return EXACTLY ONE candidate, describing the organisation behind ${knownUrl}. Set its webUrl to ${knownUrl}. Do NOT add alternative companies based on name similarity. Fill every field the research notes or website text confirm, and use empty strings for fields neither established. Set confidence to "high".

Field precedence, strongest first: (1) the raw text of the company's own website above, (2) the research notes, (3) nothing — leave the field empty. Never replace an operator-confirmed parameter with a value from a news site, directory or registry; a value from the company's own website may replace it, and if the two disagree, say so in "notes".

${profileInstructions(industries)}`
    : `CRM record (current fields):
${knownLines}${constraints}

Research notes from web search:
${research.text || "(no research output)"}

Based on the research notes, extract up to 3 candidate companies that could be the right match for this CRM record. Sort by confidence (best first). For each candidate, fill every field that the research notes confirm, and use empty strings for fields the research didn't establish. Rate confidence by how well the candidate fits the operator-confirmed parameters and the record's address / contact email. Drop any candidate that contradicts an operator-confirmed parameter — do not return it as a lower-confidence alternative.

${profileInstructions(industries)}`

  const { output: extracted } = await aiGenerateText({
    process: "clients.enrichment_extract",
    ...aiCtx,
    output: Output.object({ schema: lookupExtractSchema }),
    instructions:
      "You convert research notes and raw company-website text into structured candidate records. Never invent fields — if neither the research notes nor the website text confirms a value, return an empty string for that field. When raw website text is provided it is primary-source evidence and outranks the research notes. Operator-confirmed parameters outrank third-party sources. Use empty arrays for the candidates list if no plausible match was found.",
    prompt: extractPrompt,
    temperature: 0,
  })

  return {
    candidates: extracted.candidates.map((c) => ({
      name: c.name.trim(),
      // One address only: the model sometimes returns «info@x.ru, sales@x.ru» — the CRM field holds one e-mail.
      email: (c.email.match(/[^\s,;<>"'()]+@[^\s,;<>"'()]+\.[a-z]{2,}/i)?.[0] ?? "").toLowerCase(),
      phone: c.phone.trim(),
      address: c.address.trim(),
      webUrl: c.webUrl.trim(),
      confidence: c.confidence,
      whyMatch: c.whyMatch.trim(),
      profile: c.profile,
    })),
    sources,
    notes: extracted.notes.trim(),
  }
}

// ── Enrichment: contact fields (fill blanks) + profile (apply rule) ───────
//
// Shared by the batch («Обогатить», browser loop over
// POST /api/clients/[id]/enrich), the review queue (resolveEnrichment),
// «Заполнить из интернета» in «Профиль компании» and enrichment on create.

export const ENRICH_FILLABLE = ["webUrl", "email", "phone", "address"] as const
export type EnrichFillable = (typeof ENRICH_FILLABLE)[number]

type EnrichTarget = {
  webUrl: string | null
  email: string | null
  phone: string | null
  address: string | null
}

/** True when at least one contact field is blank. */
export function hasBlankFillable(target: EnrichTarget): boolean {
  return ENRICH_FILLABLE.some((f) => !(target[f] ?? "").trim())
}

/** Fill-blanks-only patch: never overwrites a value a human (or earlier run) set. */
export function candidatePatch(
  target: EnrichTarget,
  candidate: Pick<ClientLookupCandidate, EnrichFillable>,
): Partial<Record<EnrichFillable, string>> {
  const patch: Partial<Record<EnrichFillable, string>> = {}
  for (const field of ENRICH_FILLABLE) {
    const current = (target[field] ?? "").trim()
    const incoming = (candidate[field] ?? "").trim()
    if (!current && incoming) patch[field] = incoming
  }
  return patch
}

export type ProfileApplySummary = {
  filled: ClientProfileField[]
  proposed: ClientProfileField[]
}

const EMPTY_PROFILE_SUMMARY: ProfileApplySummary = { filled: [], proposed: [] }

/**
 * Apply the profile part of the chosen candidate to the client (apply rule,
 * src/lib/identity/client-profile-apply.ts). Field confidence is capped by
 * the candidate's match confidence. Always stamps `web_enriched_at`.
 */
export async function applyCandidateProfileForOrg(
  orgId: string,
  clientId: string,
  candidate: Pick<ClientLookupCandidate, "confidence" | "profile"> | null,
  now = new Date(),
): Promise<ProfileApplySummary> {
  const industries = await listIndustries()
  const incoming = candidate
    ? normalizeWebProfile(candidate.profile, {
        industryCodes: new Set(industries.map((i) => i.code)),
        capConfidence: candidate.confidence,
      })
    : []
  const r = await applyWebProfileToClient(orgId, clientId, incoming, now)
  return { filled: r.filled, proposed: r.proposed }
}

/** Has the client's profile been web-enriched recently (no refresh due)? */
async function profileFresh(orgId: string, clientId: string, now: Date): Promise<boolean> {
  const rows = await db
    .select({ at: clientProfile.webEnrichedAt })
    .from(clientProfile)
    .where(and(eq(clientProfile.organizationId, orgId), eq(clientProfile.clientId, clientId)))
    .limit(1)
  return !webRefreshDue(rows[0]?.at ?? null, now)
}

export type EnrichClientResult = {
  outcome: "enriched" | "review" | "no_match" | "skipped"
  filledFields: EnrichFillable[]
  candidateCount: number
  /** Profile fields written (unverified) / proposed (identity I6). */
  profile: ProfileApplySummary
}

/**
 * Process ONE client (batch / on create). Never catches the lookup error: on
 * a throw `enrichment_status` stays NULL, so the next batch run retries it.
 *  - nothing to do (contact fields complete AND profile web-enriched < 180 d)
 *    → `skipped`;
 *  - 0 candidates → `no_match` (profile stamped as enriched);
 *  - exactly one `high` candidate → contact fields fill-blanks + profile
 *    apply rule → `enriched`;
 *  - otherwise → `review` (candidates incl. their profile parked; applied
 *    when a human picks one).
 */
export async function enrichClientForOrg(
  orgId: string,
  userId: string | null,
  clientId: string,
  now = new Date(),
): Promise<EnrichClientResult> {
  const target = await loadClientInOrg(orgId, clientId)

  if (!hasBlankFillable(target) && (await profileFresh(orgId, clientId, now))) {
    await db
      .update(client)
      .set({ enrichmentStatus: "enriched", enrichmentCandidates: null })
      .where(eq(client.id, clientId))
    return { outcome: "skipped", filledFields: [], candidateCount: 0, profile: EMPTY_PROFILE_SUMMARY }
  }

  const { candidates } = await lookupClientOnWebForOrg(orgId, userId, clientId)

  if (candidates.length === 0) {
    await db
      .update(client)
      .set({ enrichmentStatus: "no_match", enrichmentCandidates: null })
      .where(eq(client.id, clientId))
    await applyCandidateProfileForOrg(orgId, clientId, null, now)
    return { outcome: "no_match", filledFields: [], candidateCount: 0, profile: EMPTY_PROFILE_SUMMARY }
  }

  if (candidates.length === 1 && candidates[0].confidence === "high") {
    const patch = candidatePatch(target, candidates[0])
    await db
      .update(client)
      .set({ ...patch, enrichmentStatus: "enriched", enrichmentCandidates: null })
      .where(eq(client.id, clientId))
    const profile = await applyCandidateProfileForOrg(orgId, clientId, candidates[0], now)
    return {
      outcome: "enriched",
      filledFields: Object.keys(patch) as EnrichFillable[],
      candidateCount: 1,
      profile,
    }
  }

  await db
    .update(client)
    .set({ enrichmentStatus: "review", enrichmentCandidates: candidates })
    .where(eq(client.id, clientId))
  return { outcome: "review", filledFields: [], candidateCount: candidates.length, profile: EMPTY_PROFILE_SUMMARY }
}

// ── «Заполнить из интернета» (profile block button) ───────────────────────

export type FillProfileResult = {
  outcome: "applied" | "ambiguous" | "no_match"
  candidateCount: number
  profile: ProfileApplySummary
}

/**
 * The profile button (responsible member or org owner — checked here). One
 * lookup; exactly ONE candidate → its profile goes through the apply rule
 * (field confidence capped by the match confidence, so a weak match only
 * yields proposals); several candidates → `ambiguous`, nothing written (the
 * user narrows the search with the website in «Поиск в интернете»); none →
 * `no_match` (stamped). Contact fields are not touched here.
 */
export async function fillClientProfileFromWeb(
  orgId: string,
  userId: string,
  clientId: string,
  now = new Date(),
): Promise<FillProfileResult> {
  await assertCanEditClientProfile(orgId, userId, clientId)
  const { candidates } = await lookupClientOnWebForOrg(orgId, userId, clientId)
  if (candidates.length === 0) {
    await applyCandidateProfileForOrg(orgId, clientId, null, now)
    return { outcome: "no_match", candidateCount: 0, profile: EMPTY_PROFILE_SUMMARY }
  }
  if (candidates.length > 1) {
    return { outcome: "ambiguous", candidateCount: candidates.length, profile: EMPTY_PROFILE_SUMMARY }
  }
  const profile = await applyCandidateProfileForOrg(orgId, clientId, candidates[0], now)
  return { outcome: "applied", candidateCount: 1, profile }
}

// ── Enrichment on create (Q6: org setting, default off) ───────────────────

/** Max clients enriched per create / discovery apply. */
export const ENRICH_ON_CREATE_CAP = 20
const ENRICH_ON_CREATE_CONCURRENCY = 3
/** Stop starting new lookups after this (the request's function still has to finish). */
const ENRICH_ON_CREATE_DEADLINE_MS = 240_000

/**
 * Background enrichment of NEW clients when the org setting
 * `clients.enrichOnCreate` is on. Never blocks or fails the create: the work
 * runs in `after()` (after the response); outside a request it runs as a
 * detached promise. ≤ 20 clients per call, 3 at a time, a 240 s deadline;
 * the AI budget is checked before each client (background work stops when the
 * org's daily budget is used up — the enrichment AI processes are
 * `interactive`, so the runtime would not stop them). Clients left over keep
 * `enrichment_status = NULL` → the batch «Обогатить» picks them up.
 */
export async function scheduleEnrichOnCreate(
  orgId: string,
  userId: string | null,
  clientIds: readonly string[],
): Promise<void> {
  try {
    const ids = [...new Set(clientIds.filter(Boolean))].slice(0, ENRICH_ON_CREATE_CAP)
    if (ids.length === 0) return
    if (!(await getOrgSetting(orgId, "clients.enrichOnCreate"))) return
    const job = () => runEnrichOnCreate(orgId, userId, ids)
    try {
      after(job)
    } catch {
      // Not inside a request scope (script, test): run detached.
      void job()
    }
  } catch (e) {
    console.error("[client-enrichment] on-create schedule failed", orgId, e)
  }
}

async function runEnrichOnCreate(orgId: string, userId: string | null, ids: string[]): Promise<void> {
  const started = Date.now()
  const queue = [...ids]
  let budgetStop = false
  const worker = async () => {
    while (queue.length > 0 && !budgetStop) {
      if (Date.now() - started > ENRICH_ON_CREATE_DEADLINE_MS) return
      const id = queue.shift()!
      try {
        const budget = await getOrgBudgetStatus(orgId)
        if (budget.exceeded) {
          budgetStop = true
          console.warn(`[client-enrichment] on-create stopped: AI budget used up for org ${orgId}`)
          return
        }
        await enrichClientForOrg(orgId, userId, id)
      } catch (e) {
        console.error("[client-enrichment] on-create enrich failed", orgId, id, e)
      }
    }
  }
  await Promise.all(Array.from({ length: ENRICH_ON_CREATE_CONCURRENCY }, worker))
}

// ── Setting «Заполнять профиль новых компаний из интернета» ───────────────

export type EnrichOnCreateSetting = { value: boolean; canManage: boolean }

async function canManageEnrichSetting(orgId: string, userId: string, isPlatformAdmin: boolean): Promise<boolean> {
  if (isPlatformAdmin) return true
  const rows = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.userId, userId)))
    .limit(1)
  return rows[0]?.role === "owner"
}

/** Read the switch (any member reads; owner / platform admin manage). */
export async function getEnrichOnCreateSetting(
  orgId: string,
  userId: string,
  isPlatformAdmin: boolean,
): Promise<EnrichOnCreateSetting> {
  const [value, canManage] = await Promise.all([
    getOrgSetting(orgId, "clients.enrichOnCreate"),
    canManageEnrichSetting(orgId, userId, isPlatformAdmin),
  ])
  return { value, canManage }
}

/** Set the switch: org owner or platform admin, else ClientProfileError 403. */
export async function setEnrichOnCreateSetting(
  orgId: string,
  userId: string,
  isPlatformAdmin: boolean,
  value: unknown,
): Promise<EnrichOnCreateSetting> {
  if (!(await canManageEnrichSetting(orgId, userId, isPlatformAdmin))) {
    throw new ClientProfileError(403, "Настройку может менять только владелец организации")
  }
  if (typeof value !== "boolean") throw new ClientProfileError(400, "Некорректное значение")
  const saved = await setOrgSetting(orgId, "clients.enrichOnCreate", value, userId)
  return { value: saved, canManage: true }
}
