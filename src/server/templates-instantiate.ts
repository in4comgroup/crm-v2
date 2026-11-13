import "server-only"

// Internal (NOT "use server"): creating source rows from templates for an
// organization. These functions take an organizationId and do NOT check the
// caller's session, so they must never be callable from the client as server
// actions. Callers check access themselves:
//   - POST /api/sources/org/instantiate (org owner check)
//   - getOrCreateAiChatSource in src/server/sources.ts (session org)
//   - the organization-create hook in src/lib/auth.ts (bootstrap)

import { db } from "@/db/drizzle"
import { source, sourceTemplate } from "@/db/schema"
import { and, eq } from "drizzle-orm"
import { randomUUID } from "node:crypto"

// ── Instantiation ────────────────────────────────────────────────────
//
// Copies a template's defaults into a new `source` row scoped to the
// given organisation. Credentials are NEVER copied (templates carry
// none); the row lands with `credentials_ref = null` and the owner
// fills it in via the existing schema-driven dialog.
//
// `idempotent`: if true (used by the org-creation bootstrap hook + the
// lazy aichat provisioner), checks for an existing row with the same
// `(orgId, templateId)` and returns its id without inserting. False by
// default — the org-owner "Add source" UI calls this without
// idempotency so an explicit second click creates a second instance
// (rare, but valid for e.g. multiple Drive folders pointing at the
// same template).
export async function instantiateFromTemplate(opts: {
  organizationId: string
  templateId: string
  createdByUserId?: string | null
  idempotent?: boolean
}): Promise<{ id: string; created: boolean }> {
  const tplRows = await db
    .select()
    .from(sourceTemplate)
    .where(eq(sourceTemplate.id, opts.templateId))
    .limit(1)
  const tpl = tplRows[0]
  if (!tpl) throw new Error(`Template not found: ${opts.templateId}`)
  if (tpl.status !== "active") {
    throw new Error(`Template is inactive: ${opts.templateId}`)
  }

  if (opts.idempotent) {
    const existing = await db
      .select({ id: source.id })
      .from(source)
      .where(
        and(
          eq(source.ownerOrganizationId, opts.organizationId),
          eq(source.templateId, opts.templateId),
        ),
      )
      .limit(1)
    if (existing[0]) {
      return { id: existing[0].id, created: false }
    }
  }

  const id = randomUUID()
  await db.insert(source).values({
    id,
    templateId: tpl.id,
    type: tpl.type,
    provider: tpl.provider,
    providerConfig:
      (tpl.defaultProviderConfig as Record<string, unknown> | null) ?? {},
    ownerOrganizationId: opts.organizationId,
    isSystem: false,
    automatedParsingIsAllowed: tpl.defaultAutomatedParsingIsAllowed,
    name: tpl.name,
    description: tpl.description,
    credentialsRef: null,
    status: "active",
    createdByUserId: opts.createdByUserId ?? null,
  })
  return { id, created: true }
}

// ── Bootstrap: instantiate every is_default template for an org ─────
//
// Called from the org-creation hook in `auth.ts`. Idempotent — re-
// running for the same org skips templates already instantiated.
export async function bootstrapDefaultsForOrg(
  organizationId: string,
  createdByUserId?: string | null,
): Promise<{ instantiated: number; alreadyExisted: number }> {
  const defaults = await db
    .select({ id: sourceTemplate.id })
    .from(sourceTemplate)
    .where(
      and(
        eq(sourceTemplate.isDefault, true),
        eq(sourceTemplate.status, "active"),
      ),
    )

  let instantiated = 0
  let alreadyExisted = 0
  for (const tpl of defaults) {
    const r = await instantiateFromTemplate({
      organizationId,
      templateId: tpl.id,
      createdByUserId: createdByUserId ?? null,
      idempotent: true,
    })
    if (r.created) instantiated++
    else alreadyExisted++
  }
  return { instantiated, alreadyExisted }
}
