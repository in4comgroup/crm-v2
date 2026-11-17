// Telegram push-ingestion. This is the org-UNSCOPED entry point that the
// public webhook route delegates to — the capability is the opaque
// `sourceId` in the URL path PLUS the per-source secret echoed in the
// `X-Telegram-Bot-Api-Secret-Token` header. There is no session here
// (Telegram is the caller), so tenant scope comes structurally from the
// source row the path resolves to: each org runs its own bot, the bot IS
// the tenant. Mirrors the guest order-link posture (token = authorization).
//
// Not "use server" — exports a plain type alongside async fns and is only
// reached from the webhook route + the credential-save side-effect.
import "server-only"

import { timingSafeEqual } from "node:crypto"
import { and, count, desc, eq, isNull, lte, ne, sql } from "drizzle-orm"
import type { Message, MessageOrigin, Update } from "grammy/types"
import { db } from "@/db/drizzle"
import { source, sourceItem } from "@/db/schema"
import { getTelegramCredentials } from "@/server/providers/credentials"
import { upsertSourceItem } from "@/server/source-items"
import { parseSourceItem } from "@/server/parse-source-item"
import { uploadSourceItem } from "@/server/upload-source-item"
import { loadAnalysisExclusions } from "@/server/analysis-exclusions"
import {
  exclusionProbeFromItem,
  matchAnalysisExclusion,
} from "@/lib/analysis-exclusion-match"
import {
  getTelegramBotInfo,
  getTelegramUpdates,
  isTelegramWebhookConflict,
  sendTelegramAck,
  setTelegramPrivateCommands,
  setTelegramWebhook,
  telegramAppOrigin,
  telegramWebhookUrl,
} from "@/lib/telegram"
import { decideTelegramWindow, parseTelegramThreadKey } from "@/lib/thread-key"
import {
  extractTelegramFiles,
  isGroupChat,
  isReadableChat,
  isTooLargeForBot,
  telegramAckText,
  telegramTooLargeText,
  type TelegramAckKind,
} from "@/lib/telegram-files"

// Resolved per-request context for a telegram webhook delivery. Loaded
// strictly by `grant`-style path id — never trusts anything in the update
// body for tenant scope.
export type TelegramWebhookContext = {
  sourceId: string
  organizationId: string | null
  botToken: string
  webhookSecret: string
  botUsername: string | null
  /** «ИИ-чат в Telegram» switch of the org owner (docs/specs/ai-chat-telegram Q1). */
  aiChatEnabled: boolean
}

// Load the source the webhook path points at and decrypt its bot creds.
// Returns null when the source doesn't exist, isn't a telegram source, or
// is inactive — the route turns that into a 404 without leaking which.
export async function resolveTelegramWebhookContext(
  sourceId: string,
): Promise<TelegramWebhookContext | null> {
  const rows = await db
    .select({
      id: source.id,
      provider: source.provider,
      status: source.status,
      organizationId: source.ownerOrganizationId,
      providerConfig: source.providerConfig,
      credentialsRef: source.credentialsRef,
    })
    .from(source)
    .where(eq(source.id, sourceId))
    .limit(1)
  const row = rows[0]
  if (!row || row.provider !== "telegram" || row.status !== "active") {
    return null
  }

  // Throws MissingCredentialsError / InvalidCredentialsError if the row
  // isn't configured — the route maps that to a 503 so Telegram retries
  // once the owner configures the bot, rather than dropping the update.
  const { botToken, webhookSecret } = getTelegramCredentials(
    sourceId,
    row.credentialsRef,
  )
  const cfg = (row.providerConfig as Record<string, unknown> | null) ?? {}
  const botUsername =
    typeof cfg.botUsername === "string" ? cfg.botUsername : null

  const me = (cfg.telegramBot ?? null) as { username?: string | null } | null
  return {
    sourceId,
    organizationId: row.organizationId,
    botToken,
    webhookSecret,
    botUsername: me?.username || botUsername,
    aiChatEnabled: cfg.aiChatEnabled === true,
  }
}

// Constant-time compare of the secret Telegram echoed back. Length-guarded
// so timingSafeEqual doesn't throw on a mismatched-length forgery.
export function verifyTelegramSecret(
  expected: string,
  received: string | null,
): boolean {
  if (!received) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(received)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

type PersistResult =
  | {
      outcome: "ingested"
      itemId: string
      inserted: boolean
      chatId: number
      isGroup: boolean
      mediaGroupId: string | null
      // "voice" → transcribed at parse; "file" → files parsed as attachments
      // at parse; "text" → body already in hand. Drives the chat reply.
      kind: TelegramAckKind
      files: number
      /** Files above Telegram's 20 MB bot limit (names) — the sender is told. */
      tooLarge: string[]
    }
  | { outcome: "ignored" }

// Telegram service/system messages — the payload lives in one of these named
// fields and `message.text` is absent, so they'd already drop out at the text
// check. We reject them explicitly so the exclusion is documented and a field
// we don't read can never slip through as a blank-text source item: chat
// joins/leaves, title/photo changes, pins, group/channel creation, chat
// migrations, and the auto-delete-timer change. (List per the Telegram
// Bot API Message object.)
const SERVICE_MESSAGE_KEYS = [
  "new_chat_members",
  "left_chat_member",
  "new_chat_title",
  "new_chat_photo",
  "delete_chat_photo",
  "pinned_message",
  "group_chat_created",
  "supergroup_chat_created",
  "channel_chat_created",
  "migrate_to_chat_id",
  "migrate_from_chat_id",
  "message_auto_delete_timer_changed",
] as const

function isServiceMessage(message: Message): boolean {
  const m = message as unknown as Record<string, unknown>
  return SERVICE_MESSAGE_KEYS.some((k) => m[k] != null)
}

// A bot command is any message whose text starts with "/" (/start, /help,
// /settings, …) — control input for the bot, never client content. Telegram
// also tags these with a `bot_command` entity at offset 0; the leading-slash
// test is the broader, simpler rule the operator asked for.
function isBotCommand(text: string): boolean {
  return text.startsWith("/")
}

// The display name of a message sender, best-effort.
function resolveSenderName(message: Message): string {
  const from = message.from
  return (
    [from?.first_name, from?.last_name].filter(Boolean).join(" ").trim() ||
    from?.username ||
    "Telegram user"
  )
}

// Non-secret descriptor of who sent a message — stamped onto every source
// item's metadata so the parser + downstream attribution have a sender.
function senderMetadata(message: Message): Record<string, unknown> | null {
  const from = message.from
  return from
    ? {
        id: from.id,
        isBot: from.is_bot,
        username: from.username ?? null,
        firstName: from.first_name ?? null,
        lastName: from.last_name ?? null,
      }
    : null
}

// Compact descriptor of where a forwarded message came from (spec topics/01
// §5.3 "Forwarded messages") — stored as `metadata_json.telegram.forwardOrigin`
// so the engine can tell the original author from the person who forwarded
// it. Null when the message is not a forward.
export type TelegramForwardOrigin =
  | {
      type: "user"
      date: number
      user: { id: number; firstName: string | null; lastName: string | null; username: string | null }
    }
  | { type: "hidden_user"; date: number; senderUserName: string }
  | {
      type: "chat" | "channel"
      date: number
      chat: { chatId: number; title: string | null; username: string | null }
    }

function forwardOriginMetadata(message: Message): TelegramForwardOrigin | null {
  const origin: MessageOrigin | undefined = message.forward_origin
  if (!origin) return null
  switch (origin.type) {
    case "user":
      return {
        type: "user",
        date: origin.date,
        user: {
          id: origin.sender_user.id,
          firstName: origin.sender_user.first_name ?? null,
          lastName: origin.sender_user.last_name ?? null,
          username: origin.sender_user.username ?? null,
        },
      }
    case "hidden_user":
      return { type: "hidden_user", date: origin.date, senderUserName: origin.sender_user_name }
    case "chat":
    case "channel": {
      const c = origin.type === "chat" ? origin.sender_chat : origin.chat
      return {
        type: origin.type,
        date: origin.date,
        chat: {
          chatId: c.id,
          title: "title" in c && typeof c.title === "string" ? c.title : null,
          username: "username" in c && typeof c.username === "string" ? c.username : null,
        },
      }
    }
    default:
      return null
  }
}

// A voice note (`message.voice`, Opus-in-Ogg) — a dictated message. The
// bot gets the FILE (Telegram gives bots no transcript); we transcribe it at
// parse time and the transcript becomes the message text (Q4). Audio FILES
// (`message.audio`) are attachments now (Q3, `extractTelegramFiles`).
function extractTelegramVoice(
  message: Message,
): { kind: "voice"; fileId: string; mimeType: string; fileName: string; duration: number; fileSize: number | null } | null {
  if (!message.voice) return null
  const v = message.voice
  return {
    kind: "voice",
    fileId: v.file_id,
    mimeType: v.mime_type ?? "audio/ogg",
    fileName: `voice-${message.message_id}.ogg`,
    duration: v.duration,
    fileSize: v.file_size ?? null,
  }
}

// Thread key `tg:<chat_id>:<window>` (spec topics/01 §6.1). The window is
// decided against the latest earlier message of the same chat (same org —
// or the same source when the source has no org — provider telegram, root
// rows): same window unless the gap is > 1 h or that window already holds
// 100 messages. A new window takes this message's id as its stable id.
// Best effort: a lookup failure never blocks ingestion (the key stays null
// and the backfill fills it later).
export async function resolveTelegramThreadKey(
  scope: { sourceId: string; organizationId: string | null },
  chatId: number,
  messageId: number,
  at: Date,
  externalId: string,
): Promise<string | null> {
  try {
    const prevRows = await db
      .select({
        threadKey: sourceItem.threadKey,
        at: sourceItem.sourceCreatedAt,
      })
      .from(sourceItem)
      .innerJoin(source, eq(source.id, sourceItem.sourceId))
      .where(
        and(
          scope.organizationId
            ? eq(sourceItem.organizationId, scope.organizationId)
            : eq(sourceItem.sourceId, scope.sourceId),
          eq(source.provider, "telegram"),
          isNull(sourceItem.parentSourceItemId),
          eq(sourceItem.threadExternalId, String(chatId)),
          ne(sourceItem.externalId, externalId),
          lte(sourceItem.sourceCreatedAt, at),
        ),
      )
      .orderBy(desc(sourceItem.sourceCreatedAt), desc(sourceItem.createdAt))
      .limit(1)
    const prev = prevRows[0]
    const prevWindow =
      prev && prev.at ? parseTelegramThreadKey(prev.threadKey) : null
    let windowSize = 0
    if (prev && prev.at && prevWindow && prev.threadKey) {
      const sizeRows = await db
        .select({ n: count() })
        .from(sourceItem)
        .where(
          and(
            scope.organizationId
              ? eq(sourceItem.organizationId, scope.organizationId)
              : eq(sourceItem.sourceId, scope.sourceId),
            eq(sourceItem.threadKey, prev.threadKey),
          ),
        )
      windowSize = Number(sizeRows[0]?.n ?? 0)
    }
    const decision = decideTelegramWindow(
      prev && prev.at
        ? { at: prev.at, windowId: prevWindow?.windowId ?? null, windowSize }
        : null,
      { at, messageId },
    )
    return `tg:${chatId}:${decision.windowId}`
  } catch (err) {
    console.warn(`[telegram] thread key lookup failed for ${externalId}:`, err)
    return null
  }
}

// Persist one update into a source_item. Pure persistence — NO secret
// verification, NO ack (callers own those). Scope (docs/specs/telegram):
// private chats AND groups / supergroups (Q15; channels never), text, voice
// notes (transcribed at parse, the transcript = the message text) and FILES
// (document / photo / video / video note / audio file — Q1, Q3): the files
// are stored as refs in `metadata_json.telegram.attachments` and become
// parsed child attachments at parse time (`parseTelegramItem`); the caption
// is the message text. Idempotency rides on `upsertSourceItem`'s
// UNIQUE(source_id, external_id) where external_id = `<chat_id>:<msg_id>`,
// so a re-delivered / re-pulled update updates the row instead of duping.
async function persistTelegramMessage(
  scope: { sourceId: string; organizationId: string | null },
  update: Update,
): Promise<PersistResult> {
  // Bot added to / removed from a group (G7): remembered on the source.
  if (update.my_chat_member) {
    await recordChatMembership(scope.sourceId, update.my_chat_member)
    return { outcome: "ignored" }
  }
  const message = update.message
  if (!message) return { outcome: "ignored" }
  if (!isReadableChat(message.chat.type)) return { outcome: "ignored" }
  // Messages of other bots in a group are not client content.
  if (message.from?.is_bot) return { outcome: "ignored" }

  // Group → supergroup migration (G7): the chat id changes; an exclusion of
  // the old id is carried to the new one.
  if (message.migrate_to_chat_id && scope.organizationId) {
    await carryChatExclusion(scope.organizationId, message.chat.id, message.migrate_to_chat_id)
    return { outcome: "ignored" }
  }
  // Drop Telegram service/system messages (joins, leaves, pins, title/photo
  // changes, migrations, auto-delete timer) — no client signal in them.
  if (isServiceMessage(message)) return { outcome: "ignored" }

  const senderName = resolveSenderName(message)
  const isGroup = isGroupChat(message.chat.type)
  const chatTitle =
    "title" in message.chat && typeof message.chat.title === "string" ? message.chat.title : null
  const telegramMeta = {
    updateId: update.update_id,
    messageId: message.message_id,
    chatId: message.chat.id,
    chatType: message.chat.type,
    ...(chatTitle ? { chatTitle } : {}),
    date: message.date,
    from: senderMetadata(message),
    forwardOrigin: forwardOriginMetadata(message),
    ...(message.media_group_id ? { mediaGroupId: message.media_group_id } : {}),
  }

  // «Исключения из анализа»: a message from an excluded chat / user (incl. a
  // forward whose origin is excluded) is not stored at all. The webhook
  // still answers 200 so Telegram does not redeliver it, and the manual
  // fetch still advances its offset past it; no chat reply is sent.
  if (scope.organizationId) {
    const exclusions = await loadAnalysisExclusions(scope.organizationId)
    if (
      exclusions.length > 0 &&
      matchAnalysisExclusion(
        exclusions,
        exclusionProbeFromItem({
          provider: "telegram",
          metadataJson: { telegram: telegramMeta },
          threadExternalId: String(message.chat.id),
        }),
      )
    ) {
      return { outcome: "ignored" }
    }
  }
  const externalId = `${message.chat.id}:${message.message_id}`
  const sourceCreatedAt = new Date(message.date * 1000)
  const baseUpsert = {
    sourceId: scope.sourceId,
    organizationId: scope.organizationId,
    externalId,
    externalType: "chat_message" as const,
    threadExternalId: String(message.chat.id),
    sourceCreatedAt,
  }
  // Only for rows that are stored (not for ignored commands / empty text).
  const threadKey = () =>
    resolveTelegramThreadKey(
      scope,
      message.chat.id,
      message.message_id,
      sourceCreatedAt,
      externalId,
    )
  const common = {
    chatId: message.chat.id,
    isGroup,
    mediaGroupId: message.media_group_id ?? null,
  }

  // Voice note: persist the file reference + any caption. Transcription
  // happens at parse time (`parseTelegramItem` downloads the bytes via the
  // stored `file_id` and runs them through the audio parser).
  const voice = extractTelegramVoice(message)
  if (voice) {
    const caption = message.caption?.trim() ?? ""
    const { id, inserted } = await upsertSourceItem({
      ...baseUpsert,
      threadKey: await threadKey(),
      metadataJson: {
        provider: "telegram",
        // No usable body text yet — the transcript is produced at parse time.
        // The caption (if any) is kept for context but isn't the parse input.
        rawText: caption,
        text: caption,
        senders: [senderName],
        telegram: { ...telegramMeta, media: voice },
      },
    })
    return { outcome: "ingested", itemId: id, inserted, kind: "voice", files: 0, tooLarge: [], ...common }
  }

  const files = extractTelegramFiles(message)
  const text = (message.text ?? message.caption ?? "").trim()
  if (!text && files.length === 0) return { outcome: "ignored" }

  // Drop bot commands (anything starting with "/": /start, /help, /settings, …)
  // — these drive the bot, they aren't messages from a client.
  if (files.length === 0 && isBotCommand(text)) return { outcome: "ignored" }

  const { id, inserted } = await upsertSourceItem({
    ...baseUpsert,
    threadKey: await threadKey(),
    metadataJson: {
      provider: "telegram",
      // `rawText` is the body the parser reads (mirrors WhatsApp) — no
      // remote API to re-fetch from, the message text lives in our DB. For a
      // file message it is the caption (may be empty).
      rawText: text,
      text,
      senders: [senderName],
      telegram: files.length > 0 ? { ...telegramMeta, attachments: files } : telegramMeta,
    },
  })

  return {
    outcome: "ingested",
    itemId: id,
    inserted,
    kind: files.length > 0 ? "file" : "text",
    files: files.length,
    tooLarge: files.filter(isTooLargeForBot).map((f) => f.fileName),
    ...common,
  }
}

// G7: the bot's membership in a group, remembered on the source
// (`provider_config.telegramGroups[chatId] = { title, status, at }`) so the
// source settings can list the connected groups. Best effort.
async function recordChatMembership(
  sourceId: string,
  m: NonNullable<Update["my_chat_member"]>,
): Promise<void> {
  try {
    if (!isGroupChat(m.chat.type)) return
    const [row] = await db
      .select({ providerConfig: source.providerConfig })
      .from(source)
      .where(eq(source.id, sourceId))
    const cfg = (row?.providerConfig as Record<string, unknown> | null) ?? {}
    const groups = { ...((cfg.telegramGroups as Record<string, unknown> | undefined) ?? {}) }
    groups[String(m.chat.id)] = {
      title: "title" in m.chat ? m.chat.title : null,
      status: m.new_chat_member.status,
      at: new Date(m.date * 1000).toISOString(),
    }
    await db.update(source).set({ providerConfig: { ...cfg, telegramGroups: groups } }).where(eq(source.id, sourceId))
  } catch (err) {
    console.warn(`[telegram] membership record failed for source ${sourceId}:`, err)
  }
}

// G7: a group became a supergroup (new chat id). An exclusion of the old
// chat id is copied to the new one (by the org's system actor). Best effort.
async function carryChatExclusion(orgId: string, oldChatId: number, newChatId: number): Promise<void> {
  try {
    const exclusions = await loadAnalysisExclusions(orgId)
    const excluded = matchAnalysisExclusion(
      exclusions,
      exclusionProbeFromItem({ provider: "telegram", metadataJson: { telegram: { chatId: oldChatId } }, threadExternalId: String(oldChatId) }),
    )
    if (!excluded) return
    const { ensureSystemActor } = await import("@/server/topics/system-actor")
    const { addAnalysisExclusion } = await import("@/server/analysis-exclusions")
    await addAnalysisExclusion({
      orgId,
      userId: await ensureSystemActor(orgId),
      kind: "chat",
      value: String(newChatId),
      note: `Группа перенесена (было ${oldChatId})`,
    })
  } catch (err) {
    console.warn(`[telegram] carrying the exclusion of chat ${oldChatId} failed:`, err)
  }
}

// Drive a freshly-ingested telegram item through parse → R2 upload so it
// becomes eligible for card / deal generation within seconds, instead of
// sitting un-parsed until the daily orchestration pipeline (cron 03:00 UTC)
// runs. Telegram arrives in real time via webhook (and on-demand via the
// pull/Fetch button); without this fast-path, an operator clicking the
// dashboard «Magic» button right after a message lands would find nothing
// eligible yet (email "just works" only because it came through an earlier
// scheduled sync that already parsed + uploaded it).
//
// Best-effort: every failure is logged and swallowed. parse + upload are
// idempotent and the orchestration pipeline re-attempts any row that isn't
// `parse_status='complete' AND r2_upload_status='complete'`, so a transient
// failure here just defers the item to the next pipeline run — it never
// blocks the ack or the fetch response.
export async function parseAndUploadTelegramItem(
  itemId: string,
  // The signed-in user on the manual Fetch path; null for the webhook.
  opts: { userId: string | null },
): Promise<void> {
  try {
    const parsed = await parseSourceItem(itemId, opts)
    if (parsed.parentStatus !== "complete") {
      console.warn(
        `[telegram] post-ingest parse not complete for ${itemId}: ` +
          `${parsed.parentParseError ?? parsed.parentStatus}`,
      )
      return
    }
    const uploaded = await uploadSourceItem(itemId)
    if (!uploaded.ok) {
      console.warn(
        `[telegram] post-ingest R2 upload failed for ${itemId}: ` +
          `${uploaded.reason} — ${uploaded.error}`,
      )
    }
  } catch (err) {
    console.error(
      `[telegram] post-ingest parse/upload threw for ${itemId}:`,
      err,
    )
  }
}

// Another message of the same album (media group) was stored before → no
// second reply.
async function albumSeenBefore(
  ctx: TelegramWebhookContext,
  chatId: number,
  mediaGroupId: string,
  itemId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: sourceItem.id })
    .from(sourceItem)
    .where(
      and(
        eq(sourceItem.sourceId, ctx.sourceId),
        eq(sourceItem.threadExternalId, String(chatId)),
        ne(sourceItem.id, itemId),
        sql`${sourceItem.metadataJson}->'telegram'->>'mediaGroupId' = ${mediaGroupId}`,
      ),
    )
    .limit(1)
  return !!row
}

export type TelegramIngestResult =
  | { ok: true; outcome: "ingested" | "ignored"; itemId?: string; inserted?: boolean }
  | { ok: false; reason: "unauthorized" }

// Webhook delivery path: verify the echoed secret, persist, then ack the
// chat. We still return 200 on ack failure so Telegram doesn't retry.
export async function ingestTelegramUpdate(
  ctx: TelegramWebhookContext,
  update: Update,
  secretHeader: string | null,
): Promise<TelegramIngestResult> {
  if (!verifyTelegramSecret(ctx.webhookSecret, secretHeader)) {
    return { ok: false, reason: "unauthorized" }
  }
  return ingestVerifiedTelegramUpdate(ctx, update, { ack: true })
}

// The ingest step of the router (src/server/telegram/router.ts): persist the
// update as a source item; `ack` = the private-chat reply (off for a forward
// that the AI chat answers, and for the manual fetch).
export async function ingestVerifiedTelegramUpdate(
  ctx: TelegramWebhookContext,
  update: Update,
  opts: { ack: boolean },
): Promise<Extract<TelegramIngestResult, { ok: true }>> {
  const result = await persistTelegramMessage(
    { sourceId: ctx.sourceId, organizationId: ctx.organizationId },
    update,
  )
  if (result.outcome === "ignored") return { ok: true, outcome: "ignored" }

  // Replies only in a private chat (G3: never spam a client's group), one per
  // album (Q9), plus the 20 MB notice (Q6). Russian (Q7).
  try {
    if (!result.isGroup && opts.ack) {
      const firstOfAlbum =
        !result.mediaGroupId ||
        !(await albumSeenBefore(ctx, result.chatId, result.mediaGroupId, result.itemId))
      if (result.tooLarge.length > 0 && result.inserted) {
        await sendTelegramAck(ctx.botToken, result.chatId, telegramTooLargeText(result.tooLarge))
      }
      if (firstOfAlbum) {
        await sendTelegramAck(ctx.botToken, result.chatId, telegramAckText(result.kind, result.inserted, result.files))
      }
    }
  } catch (err) {
    console.warn(
      `[telegram] ack failed for source ${ctx.sourceId} chat ${result.chatId}:`,
      err,
    )
  }

  return {
    ok: true,
    outcome: "ingested",
    itemId: result.itemId,
    inserted: result.inserted,
  }
}

export type TelegramFetchResult = {
  fetched: number
  ingested: number
  ignored: number
  // True when Telegram refused getUpdates because a webhook is active —
  // in that case messages arrive automatically via the webhook instead.
  webhookActive: boolean
}

// Manual long-poll pull. Drains queued updates via getUpdates and persists
// them, advancing a per-source `telegramOffset` cursor (stored in the
// non-secret provider_config) so each call only sees new messages. This is
// the org-scoped "Fetch" button's backend — primarily for local dev / any
// time no webhook is delivering. Caller (route) is responsible for the
// session + `assertSourceInScope` tenant check before invoking.
const FETCH_DRAIN_PAGES = 10 // ×100 updates = up to 1000 per click
const FETCH_PAGE_LIMIT = 100

export async function fetchTelegramUpdates(
  sourceId: string,
  // The signed-in user who clicked Fetch (attributed on the parse calls).
  opts: { userId: string | null },
): Promise<TelegramFetchResult> {
  const rows = await db
    .select({
      id: source.id,
      provider: source.provider,
      status: source.status,
      organizationId: source.ownerOrganizationId,
      providerConfig: source.providerConfig,
      credentialsRef: source.credentialsRef,
    })
    .from(source)
    .where(eq(source.id, sourceId))
    .limit(1)
  const row = rows[0]
  if (!row || row.provider !== "telegram" || row.status !== "active") {
    throw new Error(`Source ${sourceId} is not an active telegram source`)
  }

  const { botToken } = getTelegramCredentials(sourceId, row.credentialsRef)
  await refreshTelegramBotInfo(sourceId, botToken)
  const [fresh] = await db.select({ providerConfig: source.providerConfig }).from(source).where(eq(source.id, sourceId))
  const cfg = (fresh?.providerConfig as Record<string, unknown> | null) ?? {}
  let offset =
    typeof cfg.telegramOffset === "number" ? cfg.telegramOffset : undefined

  const ctx = await resolveTelegramWebhookContext(sourceId)
  if (!ctx) throw new Error(`Source ${sourceId} is not an active telegram source`)
  // The router (docs/specs/telegram/04 §5.5 C2) is loaded lazily: it imports this module.
  const { handleTelegramUpdate } = await import("@/server/telegram/router")
  let fetched = 0
  let ingested = 0
  let ignored = 0
  // Work of the updates (parse → upload of new items, AI chat turns), run at
  // the end in order, so a pulled message is immediately eligible for signals.
  const deferred: (() => Promise<void>)[] = []

  for (let page = 0; page < FETCH_DRAIN_PAGES; page++) {
    let updates
    try {
      updates = await getTelegramUpdates(botToken, {
        offset,
        limit: FETCH_PAGE_LIMIT,
      })
    } catch (err) {
      if (isTelegramWebhookConflict(err)) {
        return { fetched, ingested, ignored, webhookActive: true }
      }
      throw err
    }
    if (updates.length === 0) break

    for (const u of updates) {
      fetched++
      const r = await handleTelegramUpdate(ctx, u, { ack: false, parseUserId: opts.userId })
      if (r.outcome === "ingested" || r.outcome === "chat") ingested++
      else ignored++
      deferred.push(...r.deferred)
      // Next offset = highest seen update_id + 1 (confirms processed ones).
      offset = Math.max(offset ?? 0, u.update_id + 1)
    }
    if (updates.length < FETCH_PAGE_LIMIT) break
  }

  // Persist the advanced cursor so the next click only sees new messages.
  if (offset !== undefined) {
    await db
      .update(source)
      .set({ providerConfig: { ...cfg, telegramOffset: offset } })
      .where(eq(source.id, sourceId))
  }

  // Each task is non-throwing (parse / upload / chat worker); transient
  // failures fall back to the daily pipeline.
  for (const task of deferred) {
    await task().catch((err) => console.error(`[telegram] fetch: deferred work failed for ${sourceId}:`, err))
  }
  return { fetched, ingested, ignored, webhookActive: false }
}

// Register this source's bot webhook with Telegram. Called as a
// side-effect when an org owner / admin saves telegram credentials.
// Skips (returns false) in local dev where there's no public HTTPS origin
// — there Telegram can't reach us, so polling would be used instead.
export async function registerTelegramWebhookForSource(
  sourceId: string,
): Promise<{ registered: boolean; url?: string }> {
  const ctx = await resolveTelegramWebhookContext(sourceId)
  if (!ctx) {
    throw new Error(
      `Cannot register webhook: source ${sourceId} is not an active telegram source`,
    )
  }
  await refreshTelegramBotInfo(sourceId, ctx.botToken)
  const origin = telegramAppOrigin()
  if (!origin) {
    console.warn(
      `[telegram] no public HTTPS origin (NEXT_PUBLIC_APP_URL) — skipping webhook registration for source ${sourceId}. Use polling in local dev.`,
    )
    return { registered: false }
  }
  const url = telegramWebhookUrl(origin, sourceId)
  await setTelegramWebhook({
    botToken: ctx.botToken,
    url,
    secretToken: ctx.webhookSecret,
  })
  await setTelegramPrivateCommands(ctx.botToken).catch((err) =>
    console.warn(`[telegram] setMyCommands failed for source ${sourceId}:`, err),
  )
  return { registered: true, url }
}

// G1 (docs/specs/telegram §6): `getMe` → `provider_config.telegramBot =
// { username, canReadAllGroupMessages, canJoinGroups, checkedAt }`. False
// `canReadAllGroupMessages` = privacy mode on: in groups the bot sees only
// commands, replies and @mentions. Shown in the source settings. Best effort.
export async function refreshTelegramBotInfo(sourceId: string, botToken: string): Promise<void> {
  try {
    const info = await getTelegramBotInfo(botToken)
    const [row] = await db.select({ providerConfig: source.providerConfig }).from(source).where(eq(source.id, sourceId))
    const cfg = (row?.providerConfig as Record<string, unknown> | null) ?? {}
    await db
      .update(source)
      .set({ providerConfig: { ...cfg, telegramBot: { ...info, checkedAt: new Date().toISOString() } } })
      .where(eq(source.id, sourceId))
  } catch (err) {
    console.warn(`[telegram] getMe failed for source ${sourceId}:`, err)
  }
}
