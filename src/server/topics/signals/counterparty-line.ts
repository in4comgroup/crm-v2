import "server-only"

// Identity I4 (spec §4.5 «Signal extraction»): the per-item envelope line
// «Контрагент: <name> — <отрасль>, <роль>» when the item's client is known.
// Only used when the org profile is in the prompts (`identity.promptContext`
// or an eval run that forces it).
//
// Client id at extraction time: the item has no subjects yet (extraction
// writes them), so the cheapest reliable source is the same peer resolution
// the topic resolver uses later (topic-store `itemPeer` + counterparty
// `resolveCounterparty` with an empty subject string): the sender of an
// inbound item / the first recipient of ours → contact by email / Telegram
// handle / name → its client, or a client by a non-free-mail domain. Unique
// hits only; unknown → no line. Internal items and forwards get no line (the
// peer would be our own staff / the forwarder).

import type { SignalDirection } from "@/lib/signals/extraction-types"
import { loadClientProfileTexts } from "@/server/identity/client-profile-context"
import { resolveCounterparty, type CounterpartyIndex } from "@/server/topics/counterparty"
import { itemPeer, loadCounterpartyIndex } from "@/server/topics/topic-store"
import type { ExtractionEnvelope } from "@/server/topics/prompt/extraction"

export type ExtractionCounterparties = {
  orgId: string
  idx: CounterpartyIndex
  /** clientId → counterparty line ("" = the client has no usable profile). */
  lines: Map<string, Promise<string>>
}

/** Load once per batch (only when the org profile is in the prompt). */
export async function loadExtractionCounterparties(orgId: string): Promise<ExtractionCounterparties> {
  return { orgId, idx: await loadCounterpartyIndex(orgId), lines: new Map() }
}

/** Client id of the item's peer, or null (pre-model direction from the parse-time attribution). */
export function itemClientId(
  cp: Pick<ExtractionCounterparties, "idx">,
  item: { metadataJson: unknown; orgAttribution: string | null },
  envelope: Pick<ExtractionEnvelope, "allInternal" | "forwardedBy" | "originalAuthor">,
): string | null {
  if (envelope.allInternal || envelope.forwardedBy || envelope.originalAuthor) return null
  const direction: SignalDirection = item.orgAttribution === "own_org" ? "outbound" : "inbound"
  const peer = itemPeer(item.metadataJson, direction)
  if (!peer) return null
  return resolveCounterparty("", peer, cp.idx).clientId
}

/** The «Контрагент: …» line of the item, or null. Never throws. */
export async function counterpartyLineForItem(
  cp: ExtractionCounterparties | null,
  item: { metadataJson: unknown; orgAttribution: string | null },
  envelope: Pick<ExtractionEnvelope, "allInternal" | "forwardedBy" | "originalAuthor">,
): Promise<string | null> {
  if (!cp) return null
  try {
    const clientId = itemClientId(cp, item, envelope)
    if (!clientId) return null
    let line = cp.lines.get(clientId)
    if (!line) {
      line = loadClientProfileTexts(cp.orgId, [clientId]).then((m) => m.get(clientId)?.counterpartyLine ?? "")
      cp.lines.set(clientId, line)
    }
    return (await line) || null
  } catch (e) {
    console.error("[topics/signals] counterparty line failed", cp.orgId, e)
    return null
  }
}
