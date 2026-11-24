"use server"

// Session-bound «Найти в источниках» (Companies toolbar dialog): the active
// org + the signed-in user from the session, then the org-explicit core
// `src/server/discovery-core.ts` (shared with the automatic run,
// `src/server/discovery-auto.ts`).

import { getServerSession } from "@/lib/get-session"
import {
  applyDiscoveryForOrg,
  previewDiscoveryForOrg,
  type ApplyDiscoveryInput,
  type ApplyDiscoveryResult,
  type DiscoveryPeriod,
  type DiscoveryPreview,
} from "@/server/discovery-core"

export type {
  ApplyDiscoveryInput,
  ApplyDiscoveryResult,
  ClientCandidate,
  ClientEnrichmentEntry,
  ClientRef,
  ContactCandidate,
  ContactRef,
  DiscoveryConfidence,
  DiscoveryPeriod,
  DiscoveryPreview,
  DisplayNameEntry,
  LinkProposal,
  NativeNameEntry,
  PhoneEntry,
  PositionEntry,
} from "@/server/discovery-core"

async function requireOrgContext() {
  const session = await getServerSession()
  if (!session) throw new Error("Unauthorized")
  const activeOrgId = session.session.activeOrganizationId
  if (!activeOrgId) throw new Error("No active organization")
  return { userId: session.user.id, activeOrgId }
}

export async function previewDiscovery(opts?: {
  includeAlreadyScanned?: boolean
  period?: DiscoveryPeriod
}): Promise<DiscoveryPreview> {
  const { activeOrgId } = await requireOrgContext()
  return previewDiscoveryForOrg(activeOrgId, opts)
}

export async function applyDiscovery(input: ApplyDiscoveryInput): Promise<ApplyDiscoveryResult> {
  const { userId, activeOrgId } = await requireOrgContext()
  return applyDiscoveryForOrg(activeOrgId, { userId }, input)
}
