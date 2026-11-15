import "server-only"

// Org profile texts for the TOPICS prompts (identity spec I4, §3.6). Gated by
// the org setting `identity.promptContext` (default off): off → null, and
// every topics prompt stays byte-identical to the pre-I4 text. The golden-set
// eval forces the flag per run (`force`). Org-explicit, cron-safe.

import { orgProductsLine, orgPromptFacts, orgRoleLine } from "@/lib/identity/prompt-org-lines"
import { getOwnOrgContext } from "@/server/identity/own-org"
import { getOrgSetting } from "@/server/org-settings"

export type TopicsOrgPrompt = {
  /** «О нашей компании» block (prompt-card.ts); "" when the profile is empty. */
  card: string
  /** «Наша компания: <name> — <роли>.»; "" when unknown. */
  roleLine: string
  /** «Наши продукты и услуги: …»; "" when none. */
  productsLine: string
}

/** Is the org profile switched into the topics prompts for this org? */
export async function topicsPromptContextEnabled(orgId: string): Promise<boolean> {
  try {
    return await getOrgSetting(orgId, "identity.promptContext")
  } catch (e) {
    console.error("[identity/prompt-context] setting read failed", orgId, e)
    return false
  }
}

/**
 * The org texts for the topics prompts, or null when the switch is off (or
 * `force === false`). `force` overrides the org setting (eval runs).
 */
export async function getTopicsOrgPrompt(orgId: string, force?: boolean): Promise<TopicsOrgPrompt | null> {
  const enabled = force ?? (await topicsPromptContextEnabled(orgId))
  if (!enabled) return null
  const own = await getOwnOrgContext(orgId)
  if (!own.exists) return null
  const facts = orgPromptFacts(own.name, own.profile)
  return { card: own.promptCard, roleLine: orgRoleLine(facts), productsLine: orgProductsLine(facts) }
}
