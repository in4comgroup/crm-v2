import "server-only"

import { and, asc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { source, sourceItem } from "@/db/schema"
import {
  assignTelegramWindows,
  telegramMessageIdOf,
  threadKeyForStoredItem,
} from "@/lib/thread-key"

// Resumable, best-effort fill of `source_item.thread_key` (spec topics/01
// §6.1) for rows stored before the sync / ingest paths wrote it. One org per
// call; ROOT items only; oldest first; idempotent (only rows whose key is
// still null are written, and a written key is never changed).
//
// Rules are the same as at sync time (`src/lib/thread-key.ts`), with what
// old rows carry:
// - imap without stored References → In-Reply-To (metadata, else the
//   `thread_external_id`, which holds the envelope In-Reply-To) → own
//   Message-ID.
// - gchat → space from `metadata_json.spaceName`, else from the message
//   resource name in `external_id`.
// - whatsapp → `wa:_:<groupKey>` when the archive chat name is unknown.
// - telegram → windows over the WHOLE chat history in time order; keys that
//   already exist set the window, so new and old rows stay consistent.
//   A touched chat is processed fully, so `updated` can exceed `limit`.
//
// Rows a key cannot be computed for (documents, WhatsApp exclusion
// tombstones, mail with no ids) are not candidates, so they never block
// progress and are not counted in `remaining`.

const KEYED_PROVIDERS = ["nylas", "imap", "gchat", "telegram", "whatsapp"] as const
const UPDATE_CHUNK = 200

function nonEmpty(expr: SQL): SQL {
  return sql`nullif(btrim(${expr}), '') is not null`
}

// SQL twin of "threadKeyForStoredItem / telegram can produce a key".
function keyablePredicate(): SQL {
  const meta = sourceItem.metadataJson
  const te = nonEmpty(sql`${sourceItem.threadExternalId}`)
  return sql`(
    (${source.provider} in ('nylas', 'gchat', 'telegram') and ${te})
    or (${source.provider} = 'imap' and (
      ${te}
      or ${nonEmpty(sql`${meta}->>'inReplyTo'`)}
      or ${nonEmpty(sql`${meta}->>'messageId'`)}
      or jsonb_typeof(${meta}->'references') = 'array' and jsonb_array_length(${meta}->'references') > 0
    ))
    or (${source.provider} = 'whatsapp'
      and ${nonEmpty(sql`${meta}->>'groupKey'`)}
      and coalesce(${meta}->>'analysisExcluded', 'false') <> 'true')
  )`
}

function candidateWhere(organizationId: string): SQL | undefined {
  return and(
    eq(sourceItem.organizationId, organizationId),
    isNull(sourceItem.parentSourceItemId),
    isNull(sourceItem.threadKey),
    inArray(source.provider, [...KEYED_PROVIDERS]),
    keyablePredicate(),
  )
}

async function writeKeys(keys: Map<string, string>): Promise<number> {
  const entries = [...keys.entries()]
  let written = 0
  for (let i = 0; i < entries.length; i += UPDATE_CHUNK) {
    const chunk = entries.slice(i, i + UPDATE_CHUNK)
    const values = sql.join(
      chunk.map(([id, key]) => sql`(${id}::text, ${key}::text)`),
      sql`, `,
    )
    const res = (await db.execute(sql`
      update ${sourceItem}
      set thread_key = v.key
      from (values ${values}) as v(id, key)
      where ${sourceItem.id} = v.id and ${sourceItem.threadKey} is null
      returning ${sourceItem.id}
    `)) as unknown as { rows?: unknown[] } | unknown[]
    written += Array.isArray(res) ? res.length : (res.rows?.length ?? 0)
  }
  return written
}

export async function backfillThreadKeys(
  organizationId: string,
  limit: number,
): Promise<{ updated: number; remaining: number }> {
  const take = Math.max(1, Math.floor(limit))
  const candidates = await db
    .select({
      id: sourceItem.id,
      provider: source.provider,
      externalId: sourceItem.externalId,
      threadExternalId: sourceItem.threadExternalId,
      metadataJson: sourceItem.metadataJson,
    })
    .from(sourceItem)
    .innerJoin(source, eq(source.id, sourceItem.sourceId))
    .where(candidateWhere(organizationId))
    .orderBy(
      sql`${sourceItem.sourceCreatedAt} asc nulls last`,
      asc(sourceItem.createdAt),
      asc(sourceItem.id),
    )
    .limit(take)

  const keys = new Map<string, string>()
  const telegramChats = new Set<string>()
  for (const row of candidates) {
    if (row.provider === "telegram") {
      if (row.threadExternalId?.trim()) telegramChats.add(row.threadExternalId.trim())
      continue
    }
    const key = threadKeyForStoredItem({
      provider: row.provider,
      externalId: row.externalId,
      threadExternalId: row.threadExternalId,
      metadata: row.metadataJson as Record<string, unknown> | null,
    })
    if (key) keys.set(row.id, key)
  }

  for (const chatId of telegramChats) {
    const history = await db
      .select({
        id: sourceItem.id,
        externalId: sourceItem.externalId,
        metadataJson: sourceItem.metadataJson,
        threadKey: sourceItem.threadKey,
        sourceCreatedAt: sourceItem.sourceCreatedAt,
        createdAt: sourceItem.createdAt,
      })
      .from(sourceItem)
      .innerJoin(source, eq(source.id, sourceItem.sourceId))
      .where(
        and(
          eq(sourceItem.organizationId, organizationId),
          eq(source.provider, "telegram"),
          isNull(sourceItem.parentSourceItemId),
          eq(sourceItem.threadExternalId, chatId),
        ),
      )
      .orderBy(
        sql`coalesce(${sourceItem.sourceCreatedAt}, ${sourceItem.createdAt}) asc`,
        asc(sourceItem.createdAt),
        asc(sourceItem.id),
      )
    const windows = assignTelegramWindows(
      chatId,
      history.map((h) => ({
        id: h.id,
        at: h.sourceCreatedAt ?? h.createdAt,
        messageId:
          telegramMessageIdOf(h.metadataJson as Record<string, unknown> | null, h.externalId) ??
          h.externalId,
        threadKey: h.threadKey,
      })),
    )
    for (const [id, key] of windows) keys.set(id, key)
  }

  const updated = keys.size > 0 ? await writeKeys(keys) : 0

  const remainingRows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(sourceItem)
    .innerJoin(source, eq(source.id, sourceItem.sourceId))
    .where(candidateWhere(organizationId))

  return { updated, remaining: Number(remainingRows[0]?.n ?? 0) }
}
