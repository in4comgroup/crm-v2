import "server-only"

import { and, eq } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { signalInstance } from "@/db/schema"
import type { CheckDef, CheckKey, OpenProcessInstance } from "@/lib/topics/checks"
import { applyCheckResult, loadStoreContext } from "./checks/store"
import { getTopicsMode } from "./mode"
import { ensureSystemActor } from "./system-actor"

// Contact ↔ company links (docs/specs/clients-contacts/04 §7, Q10): an
// accepted «Перешёл в Y» where Y is a client opens ONE topic on Y
// «<Y> — знакомый контакт: перешёл из <X>» — a relationship chance, no deal.
// Written as a process instance of CONTACT_NEW_KNOWN_ORG through the phase 8
// store (origin communication, key `contact:<id>:moved_to:<clientId>`), so
// attention, cards and the journal work as for any topic. Only in topics
// mode `shadow` / `on`; the code must be active for the org. Never throws.

const CODE = "CONTACT_NEW_KNOWN_ORG"

export const CONTACT_MOVED_CHECK: CheckDef = {
  key: "contact_moved" as CheckKey,
  group: "watchdogs",
  codes: [CODE],
  schedule: "hourly",
  labelRu: "Знакомый контакт перешёл в компанию",
}

export async function openContactMovedTopic(
  orgId: string,
  m: { contactId: string; contactName: string; toClientId: string; toClientName: string | null; fromClientName: string | null },
): Promise<{ topicIds: string[] }> {
  try {
    const mode = await getTopicsMode(orgId)
    if (mode !== "shadow" && mode !== "on") return { topicIds: [] }
    const conditionKey = `contact:${m.contactId}:moved_to:${m.toClientId}`
    const found = await db
      .select()
      .from(signalInstance)
      .where(and(eq(signalInstance.organizationId, orgId), eq(signalInstance.code, CODE), eq(signalInstance.conditionKey, conditionKey)))
    const existing: OpenProcessInstance[] = found.map((i) => ({
      id: i.id,
      code: i.code,
      conditionKey: i.conditionKey ?? "",
      topicId: i.topicId,
      clientId: m.toClientId,
      facts: (i.facts as Record<string, unknown> | null) ?? {},
      createdAt: i.createdAt,
      clearedAt: i.clearedAt,
    }))
    const now = new Date()
    const actor = await ensureSystemActor(orgId)
    const sc = await loadStoreContext(orgId, now, actor)
    const from = m.fromClientName ? ` из ${m.fromClientName}` : ""
    const out = await applyCheckResult(
      sc,
      CONTACT_MOVED_CHECK,
      {
        findings: [
          {
            code: CODE,
            conditionKey,
            topicId: null,
            clientId: m.toClientId,
            contactId: m.contactId,
            companyName: m.toClientName,
            matterRu: `знакомый контакт: перешёл${from}`,
            evidenceRu: `${m.contactName} перешёл${from} в ${m.toClientName ?? "компанию"} (решение пользователя)`,
            score: null,
            facts: { contactId: m.contactId, toClientId: m.toClientId },
          },
        ],
        clears: [],
        evaluated: 1,
        skipped: {},
      },
      existing,
      1,
    )
    if (out.topicIds.length > 0) {
      const { recomputeTopicsAttention } = await import("./attention/store")
      await recomputeTopicsAttention(orgId, out.topicIds).catch((e) => console.error("[topics/contact-moved] attention", e))
    }
    return { topicIds: out.topicIds }
  } catch (e) {
    console.error("[topics/contact-moved] failed", orgId, m.contactId, e)
    return { topicIds: [] }
  }
}
