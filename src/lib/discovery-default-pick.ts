// Default choice of «Найти в источниках» (2026-11-24): which candidates are
// pre-checked in the dialog AND which ones the automatic run creates
// (`src/server/discovery-auto.ts`) — ONE rule, so «automatic» = «a person
// pressed «Применить» without changing the checkboxes».
//
// Picked: confidence high / medium, not a possible duplicate (company /
// contact), not a possible move (contact). Low-confidence candidates and
// links stay for a person (the dialog with «Повторно просканировать»).
// Pure, no server imports; unit-tested in discovery-default-pick.test.ts.

import type {
  ApplyDiscoveryInput,
  ClientCandidate,
  ContactCandidate,
  DiscoveryPreview,
  LinkProposal,
} from "@/server/discovery-core"

export function isDefaultClientPick(c: Pick<ClientCandidate, "confidence" | "possibleDuplicate">): boolean {
  return !c.possibleDuplicate && c.confidence !== "low"
}

export function isDefaultContactPick(
  c: Pick<ContactCandidate, "confidence" | "possibleDuplicate" | "possibleMove">,
): boolean {
  return !c.possibleDuplicate && !c.possibleMove && c.confidence !== "low"
}

export function isDefaultLinkPick(l: Pick<LinkProposal, "confidence">): boolean {
  return l.confidence !== "low"
}

/** The apply input of the default choice (no name overrides). */
export function defaultDiscoveryApplyInput(preview: DiscoveryPreview): ApplyDiscoveryInput {
  return {
    selectedClientKeys: preview.clientCandidates.filter(isDefaultClientPick).map((c) => c.normalisedKey),
    selectedContactEmails: preview.contactCandidates.filter(isDefaultContactPick).map((c) => c.email),
    contactNameOverrides: {},
    selectedLinks: preview.linkProposals
      .filter(isDefaultLinkPick)
      .map((l) => ({ contact: l.contact, client: l.client })),
    scannedRowIds: preview.scannedRowIds,
    candidates: { clients: preview.clientCandidates, contacts: preview.contactCandidates },
    clientEnrichments: preview.clientEnrichments,
    nativeNames: preview.nativeNames,
    displayNames: preview.displayNames,
    phones: preview.phones,
    positions: preview.positions,
  }
}
