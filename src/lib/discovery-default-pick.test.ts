import { describe, expect, it } from "vitest"
import {
  defaultDiscoveryApplyInput,
  isDefaultClientPick,
  isDefaultContactPick,
  isDefaultLinkPick,
} from "./discovery-default-pick"
import type { ClientCandidate, ContactCandidate, DiscoveryPreview, LinkProposal } from "@/server/discovery-core"

const client = (key: string, over: Partial<ClientCandidate> = {}): ClientCandidate => ({
  displayName: key,
  normalisedKey: key,
  aliases: [],
  confidence: "high",
  occurrences: 1,
  inferredWebUrl: null,
  sampleSourceItemIds: [],
  possibleDuplicate: null,
  ...over,
})

const contact = (email: string, over: Partial<ContactCandidate> = {}): ContactCandidate =>
  ({ displayName: email, email, confidence: "high", possibleDuplicate: null, possibleMove: null, ...over }) as ContactCandidate

const link = (email: string, key: string, confidence: LinkProposal["confidence"]): LinkProposal => ({
  contact: { kind: "new", email },
  client: { kind: "new", normalisedKey: key },
  contactName: email,
  contactEmail: email,
  clientName: key,
  matchedVia: "domain",
  matchedLabel: key,
  confidence,
  ambiguous: false,
})

describe("discovery default pick", () => {
  it("picks high / medium, never low or a possible duplicate", () => {
    expect(isDefaultClientPick(client("a"))).toBe(true)
    expect(isDefaultClientPick(client("a", { confidence: "medium" }))).toBe(true)
    expect(isDefaultClientPick(client("a", { confidence: "low" }))).toBe(false)
    expect(isDefaultClientPick(client("a", { possibleDuplicate: { clientId: "c1", name: "A" } }))).toBe(false)
  })

  it("never picks a contact that may be a duplicate or a move", () => {
    expect(isDefaultContactPick(contact("a@x.ru"))).toBe(true)
    expect(isDefaultContactPick(contact("a@x.ru", { confidence: "low" }))).toBe(false)
    expect(
      isDefaultContactPick(contact("a@x.ru", { possibleDuplicate: { contactId: "k", name: "A" } } as Partial<ContactCandidate>)),
    ).toBe(false)
    expect(
      isDefaultContactPick(contact("a@x.ru", { possibleMove: { contactId: "k" } } as unknown as Partial<ContactCandidate>)),
    ).toBe(false)
    expect(isDefaultLinkPick({ confidence: "low" })).toBe(false)
    expect(isDefaultLinkPick({ confidence: "medium" })).toBe(true)
  })

  it("builds the apply input of the default choice and keeps every scanned row", () => {
    const preview = {
      scannedRowCount: 3,
      scannedRowIds: ["r1", "r2", "r3"],
      clientCandidates: [client("acme"), client("junk", { confidence: "low" })],
      contactCandidates: [contact("a@acme.ru"), contact("b@gmail.com", { confidence: "low" })],
      linkProposals: [link("a@acme.ru", "acme", "high"), link("b@gmail.com", "acme", "low")],
      clientEnrichments: [],
      nativeNames: [],
      displayNames: [],
      phones: [],
      positions: [],
    } satisfies DiscoveryPreview
    const input = defaultDiscoveryApplyInput(preview)
    expect(input.selectedClientKeys).toEqual(["acme"])
    expect(input.selectedContactEmails).toEqual(["a@acme.ru"])
    expect(input.selectedLinks).toEqual([{ contact: { kind: "new", email: "a@acme.ru" }, client: { kind: "new", normalisedKey: "acme" } }])
    expect(input.scannedRowIds).toEqual(["r1", "r2", "r3"])
    expect(input.contactNameOverrides).toEqual({})
  })
})
