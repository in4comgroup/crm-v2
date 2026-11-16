// Not "use server" — exports a plain type alongside the async fn.
// `server-only` keeps the module out of the client bundle.
import "server-only"

import { isStepCount } from "ai"

import { aiCallInfo, aiGenerateText } from "@/server/ai/runtime"

// ── Web search as an explicit tool, not a passthrough ────────────────
//
// A vendor's built-in web-search grounding is NOT a function the model calls —
// it's a per-step server-side behaviour the model may or may not engage.
// Handing it straight to the chat's streaming call proved unreliable
// (measured via the gateway on a flash-lite class model):
//
//   • alongside custom function tools → grounded 0 / 3 runs
//   • as the only tool, casual question → grounded 1 / 3 runs
//
// The failure is silent and worse than a plain error: the model answers a
// "what's on the web about X" question from stale training data and presents
// it under a «в интернете» heading, so a wrong headcount or a former owner
// reads as a fresh lookup.
//
// So web search gets the same two-pass shape `lookupClientOnWeb` already uses
// in src/server/clients.ts: ONE dedicated sub-call (process
// `chat.web_search`, capability `web_search`) whose only tool is the web
// search tool and whose prompt leaves the model no other way to answer.
// Grounding is reliable under those conditions. Two payoffs beyond
// reliability: the caller gets real source URLs back (so answers can cite),
// and because the search is its own call, web search works whatever model
// the chat itself runs on.

export type WebSearchSource = { url: string; title: string }

export type WebSearchResult = {
  query: string
  findings: string
  sources: WebSearchSource[]
  grounded: boolean
}

const RESEARCH_SYSTEM =
  "You are a precise web-research assistant. You MUST use the web search " +
  "tool to answer — you have no other source of truth, and your own training " +
  "data is months out of date. Prefer official websites, corporate " +
  "registries, and reputable news over aggregators and social media. Never " +
  "invent a detail: if the search results don't confirm something, say so " +
  "explicitly."

/**
 * Run ONE grounded web search and return what it found.
 *
 * Never throws — a failed search returns `grounded: false` with the error in
 * `findings`, so a web hiccup degrades the chat answer instead of killing the
 * whole stream. `grounded` tells the caller whether real search results
 * actually backed the findings; the chat prompt requires the model to say so
 * when they didn't.
 */
export async function searchWeb(
  query: string,
  ai: { orgId: string; userId: string | null },
): Promise<WebSearchResult> {
  const q = query.trim()
  if (!q) {
    return { query, findings: "Empty query.", sources: [], grounded: false }
  }

  try {
    const research = await aiGenerateText({
      process: "chat.web_search",
      orgId: ai.orgId,
      userId: ai.userId,
      capabilities: ["web_search"],
      instructions: RESEARCH_SYSTEM,
      prompt:
        `Research this on the web and report what you find: ${q}\n\n` +
        `Search in the local language of the subject as well as in English — ` +
        `a company's own local-language site beats an English directory. ` +
        `Write concise findings (a few short paragraphs or bullets), and for ` +
        `each concrete claim say which source it came from. State plainly ` +
        `whatever the search did NOT confirm.`,
      // Bound the search → read → answer loop so it can't spiral.
      stopWhen: isStepCount(5),
      // Same question, same answer — the client lookup needs this for the
      // same reason (two runs used to disagree on a company's address).
      temperature: 0,
    })

    // Grounded search exposes what it consulted on `result.sources`; the
    // Source union has both 'url' and 'document' variants, so narrow first.
    const sources: WebSearchSource[] = (research.sources ?? []).flatMap((s) =>
      s.sourceType === "url" ? [{ url: s.url, title: s.title ?? s.url }] : [],
    )

    return {
      query: q,
      findings: research.text || "(no findings)",
      sources,
      grounded: sources.length > 0 || aiCallInfo(research)?.webSearchGrounded === true,
    }
  } catch (error) {
    console.error("[web-search] failed:", error)
    return {
      query: q,
      findings: `Web search failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      sources: [],
      grounded: false,
    }
  }
}
