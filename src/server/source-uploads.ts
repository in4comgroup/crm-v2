import "server-only"

import { and, eq } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { source, sourceItem } from "@/db/schema"

// DB access for the inline-upload source routes (WhatsApp archive, Files
// Drop Off). All functions take the org / source ids as explicit params —
// the calling route owns the session check.

export type NewSourceItem = typeof sourceItem.$inferInsert
type SourceProvider = typeof source.$inferSelect.provider

/**
 * The active source of `provider` owned by `organizationId`. Per spec there
 * is exactly one WhatsApp / drop-off source per org; every such source is
 * owned by exactly one org (the old `is_system = true` lookup no longer
 * matches after per-org sources landed).
 */
export async function findActiveOrgSourceByProvider(
  provider: SourceProvider,
  organizationId: string,
): Promise<{ id: string; organizationId: string | null } | undefined> {
  const rows = await db
    .select({
      id: source.id,
      organizationId: source.ownerOrganizationId,
    })
    .from(source)
    .where(
      and(
        eq(source.provider, provider),
        eq(source.ownerOrganizationId, organizationId),
        eq(source.status, "active"),
      ),
    )
    .limit(1)
  return rows[0]
}

/**
 * Existing chat-group rows (`chat_message`) of a source. Used to pre-fill
 * the filename → parent group map so chunked uploads work: chunk 0 carries
 * `_chat.txt` and inserts groups; chunks 1+ carry only media files but
 * still need to find their parent group rows.
 */
export async function listChatMessageItems(sourceId: string) {
  return db
    .select({
      id: sourceItem.id,
      metadataJson: sourceItem.metadataJson,
    })
    .from(sourceItem)
    .where(
      and(
        eq(sourceItem.sourceId, sourceId),
        eq(sourceItem.externalType, "chat_message"),
      ),
    )
}

/**
 * Dedup lookup: the id of the item with this (sourceId, externalId), or
 * null when none exists.
 */
export async function findSourceItemIdByExternalId(
  sourceId: string,
  externalId: string,
): Promise<string | null> {
  const rows = await db
    .select({ id: sourceItem.id })
    .from(sourceItem)
    .where(
      and(
        eq(sourceItem.sourceId, sourceId),
        eq(sourceItem.externalId, externalId),
      ),
    )
    .limit(1)
  return rows.length > 0 ? rows[0].id : null
}

/** Insert one `source_item` row exactly as given. */
export async function insertSourceItem(values: NewSourceItem): Promise<void> {
  await db.insert(sourceItem).values(values)
}
