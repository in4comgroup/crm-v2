import "server-only"

import { randomUUID } from "node:crypto"
import { and, desc, eq, gte, isNull, lte, ne, sql } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { loadTelegramDirectory, resolveInputOf, stampTelegramResolved } from "@/server/telegram/directory"
import { resolveTelegramMessage, type TelegramDirectory, type TgPerson } from "@/lib/telegram/resolve"
import {
  signalInstance,
  source,
  sourceItem,
  sourceItemSubject,
  type ParseStatus,
  type SourceItemKind,
  type OrgAttribution,
} from "@/db/schema"
import { detachSourceItemFromTopics } from "@/server/topics/topic-store"
import {
  buildOwnOrgPromptLine,
  parserAiContext,
  type MetadataAnalysis,
  type ParserAiContext,
} from "@/server/parsers/_shared"
import {
  orgIdentityFromContext,
  ownOrgIdentityFromContext,
  type OwnOrgIdentity,
} from "@/server/org-identity"
import {
  extractAuthorEmails,
  extractAuthorTelegramHandle,
  resolveOrgAttribution,
  type OrgAttributionResult,
} from "@/server/parsers/org-attribution"
import { getOwnOrgContext, type OwnOrgContext } from "@/server/identity/own-org"
import { computeAllInternal } from "@/lib/identity/own-org-sets"
import { detectForward } from "@/lib/ru-mail"
import { companyMatchKey } from "@/lib/translit-ru"
import { extractWebsiteDomain } from "@/lib/email-domain"
import { PARSER_CONFIG } from "@/lib/parser-config"
import { triageInlineImage } from "@/lib/image-triage"
import { getNylasClient } from "@/lib/nylas"
import { downloadChatAttachmentBytes } from "@/lib/google-chat"
import {
  parseEmailMessage,
  EmailFilteredError,
  type NylasAttachmentRef,
  type InlineBodyImage,
} from "@/server/parsers/text"
import { parseImapMessage, type ImapAttachment } from "@/server/parsers/imap"
import { parseChatMessage, type ChatAttachmentRef } from "@/server/parsers/chat"
import { parseWhatsAppGroup } from "@/server/parsers/whatsapp"
import { parseTelegramMessage } from "@/server/parsers/telegram"
import { parseDriveFile } from "@/server/parsers/drive"
import {
  parseDropoffFile,
  UnsupportedDropoffTypeError,
} from "@/server/parsers/dropoff"
import { getObject } from "@/server/storage"
import { DOCUMENT_MAX_BYTES } from "@/lib/documents"
import { parsePdfBytes, PdfTooLargeError } from "@/server/parsers/pdf"
import {
  parseImageBytes,
  isSupportedImageType,
  ImageTooLargeError,
  UnsupportedImageTypeError,
} from "@/server/parsers/image"
import {
  parseAudioBytes,
  isSupportedAudioType,
  AudioTooLargeError,
  UnsupportedAudioTypeError,
} from "@/server/parsers/audio"
import {
  parseVideoBytes,
  isSupportedVideoType,
  VideoTooLargeError,
  UnsupportedVideoTypeError,
} from "@/server/parsers/video"
import {
  parseOfficeBytes,
  isSupportedOfficeType,
  detectOfficeFormat,
  officeMediaType,
  OfficeTooLargeError,
  UnsupportedOfficeTypeError,
} from "@/server/parsers/office"
import { getHandler } from "@/server/providers/handlers"
import { findItemExclusion } from "@/server/analysis-exclusions"
import { exclusionReason } from "@/lib/analysis-exclusion-match"
// These two are also called directly from provider-specific attachment
// download helpers below (Nylas attachment fetch, Chat attachment fetch)
// — those branches are already inside provider-conditional code paths,
// so the matcher call doesn't need to go through the registry dispatch.
import {
  isNylasItemMissing,
  isGoogleChatItemMissing,
} from "@/server/parsers/_provider-errors"
import {
  getNylasCredentials,
  getImapCredentials,
  getGchatCredentials,
  getGdriveCredentials,
  getTelegramCredentials,
} from "@/server/providers/credentials"
import { downloadTelegramFile } from "@/lib/telegram"
import {
  fileOnlyMessageText,
  isTooLargeForBot,
  readTelegramFileRefs,
  telegramFileExternalId,
  type TelegramFileRef,
} from "@/lib/telegram-files"
import { imapProviderConfigSchema } from "@/server/providers/handlers"
import type {
  GchatCredentials,
  NylasCredentials,
} from "@/server/providers/handlers"

// ── Re-parse ──────────────────────────────────────────────────────────

// Resets a root row to 'pending' and deletes its children (cascade
// handles grandchildren — `parent_source_item_id` has onDelete cascade).
// The next Parse call starts from a clean slate. The root's own storage
// object is overwritten under the same key by the next Upload, and its
// stored original file (`file_*`, documents) is kept. The children's stored
// objects (original files + markdown) are deleted first — the recreated
// children get new ids — and the links a person made on them are carried
// over to the new children (docs/specs/attachments).
export async function reparseSourceItem(
  itemId: string,
  opts: { actorUserId?: string | null } = {},
): Promise<void> {
  const rows = await db
    .select({
      id: sourceItem.id,
      parentSourceItemId: sourceItem.parentSourceItemId,
      organizationId: sourceItem.organizationId,
      provider: source.provider,
      fileStatus: sourceItem.fileStatus,
    })
    .from(sourceItem)
    .innerJoin(source, eq(source.id, sourceItem.sourceId))
    .where(eq(sourceItem.id, itemId))
    .limit(1)
  const row = rows[0]
  if (!row) throw new Error(`Source item not found: ${itemId}`)
  if (row.parentSourceItemId !== null) {
    throw new Error(
      "Re-parse is only supported on root rows; child rows are recreated by re-parsing their parent",
    )
  }
  // A drop-off row is re-parsed from its stored original; without one the
  // reset would only lose the parsed text (the bytes were never kept).
  if (row.provider === "dropoff" && row.fileStatus !== "stored") {
    throw new Error(
      "Drop-off file has no stored original — upload the file again to analyse it",
    )
  }

  // Documents: delete the children's stored objects, keep their manual /
  // removed links for the next parse (best effort, never throws).
  if (row.organizationId) {
    const { carryDocumentLinksForReparse } = await import("@/server/documents-ingest")
    await carryDocumentLinksForReparse(row.organizationId, itemId)
  }

  // Delete children directly. Cascade on the FK handles any grandchildren
  // (e.g. derived audio under a video attachment).
  await db
    .delete(sourceItem)
    .where(eq(sourceItem.parentSourceItemId, itemId))

  // Topics engine output of the old parse (spec topics/01 §11). First take
  // the item off its topics (topics left with no evidence are deleted, the
  // others recomputed and journaled), then drop the item's signal instances
  // and subjects; the columns are reset below.
  if (row.organizationId) {
    await detachSourceItemFromTopics(row.organizationId, itemId, {
      actorUserId: opts.actorUserId ?? null,
      reason: "reparse",
    })
  }
  await db.delete(signalInstance).where(eq(signalInstance.sourceItemId, itemId))
  await db
    .delete(sourceItemSubject)
    .where(eq(sourceItemSubject.sourceItemId, itemId))

  await db
    .update(sourceItem)
    .set({
      parseStatus: "pending",
      parsedAt: null,
      parserModel: null,
      parsedMarkdown: null,
      parseError: null,
      r2UploadStatus: "pending",
      r2UploadedAt: null,
      markdownR2Key: null,
      markdownR2SizeBytes: null,
      // Reset authorship so the next parse recomputes from scratch
      // (refs/org-attribution.md).
      orgAttribution: "unknown",
      // Re-parsing produces fresh metadata. Clear the unified discovery
      // stamp so the next applyDiscovery() run re-considers this row.
      discoveryScannedAt: null,
      // Topics signal extraction must run again on the new parse.
      // `threadKey` is kept (it does not depend on the parse).
      signalStatus: null,
      signalReason: null,
      signalScore: null,
      signalBand: null,
      signalFacts: null,
      signalScannedAt: null,
      signalAttempts: 0,
      signalTaxonomyVersion: null,
      // Topic resolution must run again after the new signals.
      topicStatus: null,
      topicReason: null,
      topicScannedAt: null,
      topicAttempts: 0,
    })
    .where(eq(sourceItem.id, itemId))
}

export type ParseResult = {
  parentStatus: ParseStatus
  parentMarkdownBytes: number
  childInserted: number
  childSkipped: number
  childFailed: number
  // Reason set by the catch arm when parentStatus is 'failed' or
  // 'skipped' — same string that lands on `source_item.parse_error`.
  // Surfaced here so HTTP callers can show a meaningful toast without
  // a follow-up DB read.
  parentParseError?: string
}

// Loaded once per parseSourceItem call — joins the source row so we know
// the provider, the org, and the per-source provider config.
type ParseContext = {
  itemId: string
  sourceId: string
  organizationId: string | null
  externalId: string
  provider:
    | "nylas"
    | "imap"
    | "gchat"
    | "gdrive"
    | "dropoff"
    | "whatsapp"
    | "aichat"
    | "telegram"
  threadExternalId: string | null
  sourceCreatedAt: Date | null
  parentNamespacedSourceId: string  // markdown frontmatter source_id for the parent
  sourceSystemLabel: string         // for the parser's "source_system" frontmatter
  // Frozen snapshot of source_item.metadata_json — needed by providers
  // that don't fetch their content from a remote API at parse time
  // (currently WhatsApp, which reads its conversation transcript out of
  // metadataJson.rawText). Other providers ignore this.
  metadataJson: Record<string, unknown>
  // Encrypted credentials blob from the source row. Decrypted on demand
  // by the per-provider arms via `getNylasCredentials` /
  // `getGchatCredentials` / `getGdriveCredentials`. Null for providers
  // that don't need credentials (dropoff/whatsapp/aichat).
  credentialsRef: string | null
  // The CRM owner's own identity (domains + company keys), loaded once per
  // parse. Used to strip the owner's own company out of the extracted
  // `companies` / `organizations` before they're persisted, so downstream
  // consumers (discovery, cards, deals, chat search) never see the owner's own
  // org as if it were a client. No-op when the org profile has no website/email.
  ownOrg: OwnOrgIdentity
  // The org's «us» context (identity spec §3.5), loaded ONCE per parse; the
  // source of `ownOrg`, the attribution identity, `allInternal` and the
  // parser prompts' «this is us» line. Null for a row with no organization.
  ownCtx: OwnOrgContext | null
  // The parent's org-attribution verdict, read by `insertParsedChild` so
  // children inherit it (an attachment of our own email is ours). Set by
  // `primeOrgAttribution` BEFORE the children when the root is marked
  // complete after them (mail, Google Chat, Telegram files — docs/specs/
  // telegram §4.6), else by `markParsed`.
  orgAttributionValue?: OrgAttribution
  primedAttribution?: OrgAttributionResult
  // Telegram (docs/specs/telegram/04 §8, TI1): the org's Telegram directory of
  // this parse, and «the author is our member by a VERIFIED binding id» for
  // the attribution (rule 1d0, before the typed-handle rule 1d).
  telegramDirectory?: TelegramDirectory
  telegramStaffVia?: "staff_binding" | null
  // A member's message in a chat marked internal (TI4 §7.4) → `allInternal`.
  telegramAllInternal?: boolean
  // Who every model call of this parse is for: the item's organization +
  // the signed-in user on manual paths (null for cron / webhook).
  ai: ParserAiContext
}

export async function parseSourceItem(
  itemId: string,
  // The signed-in user on manual paths (parse / process / fetch routes);
  // null for cron and webhook paths. The org comes from the item row.
  // `interactive`: the user waits (an AI chat file read at send) — the
  // parser calls pass the daily AI budget gate like interactive processes.
  opts: { userId: string | null; interactive?: boolean },
): Promise<ParseResult> {
  const ctx = await loadParseContext(itemId, opts.userId)
  if (opts.interactive) ctx.ai = { ...ctx.ai, interactive: true }

  // «Исключения из анализа» (spec topics/01 §5.2 gate 3a): an item with an
  // excluded address / domain / chat is never parsed and never sent to a
  // model. Covers items synced before the exclusion was added and providers
  // that cannot filter at sync. Stored like the junk skip: 'skipped' + the
  // reason on parse_error (`excluded: <kind> <value>`).
  const exclusion = await findItemExclusion({
    organizationId: ctx.organizationId,
    provider: ctx.provider,
    metadataJson: ctx.metadataJson,
    threadExternalId: ctx.threadExternalId,
    externalId: ctx.externalId,
  })
  if (exclusion) {
    const reason = exclusionReason(exclusion)
    await db
      .update(sourceItem)
      .set({ parseStatus: "skipped", parseError: reason, parsedAt: new Date() })
      .where(eq(sourceItem.id, itemId))
    return {
      parentStatus: "skipped",
      parentMarkdownBytes: 0,
      childInserted: 0,
      childSkipped: 0,
      childFailed: 0,
      parentParseError: reason,
    }
  }

  // Mark in-flight so the table shows "Parsing…" even if the user reloads.
  await db
    .update(sourceItem)
    .set({ parseStatus: "processing", parseError: null })
    .where(eq(sourceItem.id, itemId))

  try {
    const result = await dispatchParse(ctx)
    // Documents (docs/specs/attachments §4): automatic links of the item
    // (when a document) and of the document children this parse inserted.
    // Best effort — never changes the parse result.
    if (ctx.organizationId && result.parentStatus === "complete") {
      try {
        const { autoLinkAfterParse } = await import("@/server/documents-ingest")
        await autoLinkAfterParse(ctx.organizationId, itemId)
      } catch (err) {
        console.error(`[parse] document links of ${itemId} failed:`, err)
      }
      // Contact ↔ company links (docs/specs/clients-contacts/04 §4): rules
      // P1–P4 write pending proposals. Deterministic, never throws.
      const { scanItemForContactLinks } = await import("@/server/contact-links")
      await scanItemForContactLinks(ctx.organizationId, itemId)
    }
    return result
  } catch (err) {
    // Three skip-vs-fail outcomes:
    //   • Junk filter (Nylas only): the LLM classified the email as
    //     automated/transactional. Mark skipped so it stays as audit
    //     and never re-parses (sync upserts preserve parseStatus).
    //   • Provider deletion: the row exists in our DB but was deleted
    //     at the provider — same skip semantics.
    //   • Anything else: failed, with the raw error message.
    let status: ParseStatus
    let reason: string
    if (err instanceof EmailFilteredError) {
      status = "skipped"
      reason = `filtered: ${err.category} — ${err.classifierReason}`
    } else if (getHandler(ctx.provider).isItemMissing?.(err) ?? false) {
      status = "skipped"
      reason = "Source item no longer exists at provider"
    } else {
      status = "failed"
      reason = err instanceof Error ? err.message : String(err)
    }

    await db
      .update(sourceItem)
      .set({
        parseStatus: status,
        parseError: reason,
        parsedAt: new Date(),
      })
      .where(eq(sourceItem.id, itemId))
    return {
      parentStatus: status,
      parentMarkdownBytes: 0,
      childInserted: 0,
      childSkipped: 0,
      childFailed: 0,
      parentParseError: reason,
    }
  }
}

async function dispatchParse(ctx: ParseContext): Promise<ParseResult> {
  switch (ctx.provider) {
    case "nylas":
      return parseNylasItem(ctx)
    case "imap":
      return parseImapItem(ctx)
    case "gchat":
      return parseGoogleChatItem(ctx)
    case "gdrive":
      return parseGoogleDriveItem(ctx)
    case "whatsapp":
      return parseWhatsAppItem(ctx)
    case "telegram":
      return parseTelegramItem(ctx)
    case "dropoff":
      // Drop-off rows with a stored original (uploads in an entity view,
      // org-level drop-off since documents D1) parse like any other file;
      // old rows without bytes cannot be re-parsed (see parseDropoffItem).
      return parseDropoffItem(ctx)
    case "aichat": {
      // Files of the AI chat (docs/specs/ai-chat-tools §5.2): uploaded with
      // their original → parsed like a drop-off file (the parser of their
      // type). AI-chat SEGMENT items arrive pre-parsed by the chat ingest
      // (`src/server/chat/ingest.ts`); nothing to re-run for them.
      const [f] = await db
        .select({ fileStatus: sourceItem.fileStatus })
        .from(sourceItem)
        .where(eq(sourceItem.id, ctx.itemId))
      if (f?.fileStatus === "stored") return parseDropoffItem(ctx)
      throw new Error(
        "AI chat segment items are stored pre-parsed by the chat ingest; nothing to re-parse",
      )
    }
    default: {
      const _exhaustive: never = ctx.provider
      throw new Error(`Unsupported provider: ${_exhaustive}`)
    }
  }
}

async function loadParseContext(
  itemId: string,
  userId: string | null,
): Promise<ParseContext> {
  const rows = await db
    .select({
      id: sourceItem.id,
      sourceId: sourceItem.sourceId,
      organizationId: sourceItem.organizationId,
      externalId: sourceItem.externalId,
      threadExternalId: sourceItem.threadExternalId,
      sourceCreatedAt: sourceItem.sourceCreatedAt,
      parseStatus: sourceItem.parseStatus,
      provider: source.provider,
      metadataJson: sourceItem.metadataJson,
      credentialsRef: source.credentialsRef,
    })
    .from(sourceItem)
    .innerJoin(source, eq(source.id, sourceItem.sourceId))
    .where(eq(sourceItem.id, itemId))
    .limit(1)
  const row = rows[0]
  if (!row) throw new Error(`Source item not found: ${itemId}`)
  if (row.parseStatus === "complete") {
    throw new Error(
      "Source item is already parsed — use the Re-parse action to start over",
    )
  }

  // Namespaced source IDs as used by the parsers in their YAML
  // frontmatter (kept stable so the markdown corpus has consistent
  // cross-references).
  const namespaced = (() => {
    switch (row.provider) {
      case "nylas":
        return `nylas:${row.externalId}`
      case "imap":
        // externalId is "<uidValidity>:<uid>".
        return `imap:${row.externalId}`
      case "gchat": {
        // externalId is full "spaces/X/messages/Y"; the message id is the
        // trailing segment.
        const last = row.externalId.split("/").pop() ?? row.externalId
        return `gchat:${last}`
      }
      case "gdrive":
        return `drive:${row.externalId}`
      case "dropoff":
        return `dropoff:${row.externalId}`
      case "whatsapp":
        return `whatsapp:${row.externalId}`
      case "aichat":
        // externalId is already `aichat:<sessionId>`; pass through.
        return row.externalId
      case "telegram":
        // externalId is `<chat_id>:<message_id>`.
        return `telegram:${row.externalId}`
    }
  })()

  const ownCtx = row.organizationId ? await getOwnOrgContext(row.organizationId) : null

  const sourceSystemLabel = (() => {
    switch (row.provider) {
      case "nylas":
        return "Email"
      case "imap":
        return "Email"
      case "gchat":
        return "Google Chat"
      case "gdrive":
        return "Google Drive"
      case "dropoff":
        return "Dropped File"
      case "whatsapp":
        return "WhatsApp"
      case "aichat":
        return "AI Chat"
      case "telegram":
        return "Telegram"
    }
  })()

  return {
    itemId: row.id,
    sourceId: row.sourceId,
    organizationId: row.organizationId,
    externalId: row.externalId,
    provider: row.provider,
    threadExternalId: row.threadExternalId,
    sourceCreatedAt: row.sourceCreatedAt,
    parentNamespacedSourceId: namespaced,
    sourceSystemLabel,
    metadataJson: (row.metadataJson as Record<string, unknown> | null) ?? {},
    credentialsRef: row.credentialsRef,
    ownOrg: ownOrgIdentityFromContext(ownCtx),
    ownCtx,
    // A row without an organization (system source) is a system call. The
    // context carries the «this is us — leave it out of companies» line
    // (identity spec I4); "" for an org with no name and no own domain.
    ai: parserAiContext(row.organizationId, userId, buildOwnOrgPromptLine(ownCtx)),
  }
}

/**
 * Strip the CRM owner's own company out of the LLM-extracted `companies` /
 * `organizations` before persisting. Emails are usually addressed TO the
 * owner's mailbox, so the parser often lists the owner's own org as a
 * "company" — which then pollutes client discovery, cards, deals, and chat
 * search. We drop own-company entries entirely, and for any organisation whose
 * NAME is external but whose `webUrl` resolved to the owner's own domain (the
 * parser sometimes attributes the recipient domain to the company the email is
 * about) we blank just the URL and keep the company. No-op when the org has no
 * configured identity. Mirrors the discovery-side own-org guard.
 */
function filterAnalysisOwnOrg(
  analysis: MetadataAnalysis,
  ownOrg: OwnOrgIdentity,
): MetadataAnalysis {
  if (!ownOrg.hasIdentity) return analysis

  const companies = (analysis.companies ?? []).filter(
    (c) => !ownOrg.isOwnCompanyKey(companyMatchKey(c)),
  )

  const next: MetadataAnalysis = { ...analysis, companies }

  if (Array.isArray(analysis.organizations)) {
    next.organizations = analysis.organizations
      .filter((o) => !ownOrg.isOwnCompanyKey(companyMatchKey(o.name ?? "")))
      .map((o) => {
        const d = o.webUrl ? extractWebsiteDomain(o.webUrl) : ""
        return d && ownOrg.isOwnDomain(d) ? { ...o, webUrl: "" } : o
      })
  }

  return next
}

// ── Nylas (email) ─────────────────────────────────────────────────────

async function parseNylasItem(ctx: ParseContext): Promise<ParseResult> {
  const creds = getNylasCredentials(ctx.sourceId, ctx.credentialsRef)
  const parsed = await parseEmailMessage(ctx.externalId, creds, ctx.ai)


  await primeOrgAttribution(ctx, parsed.markdown)
  let inserted = 0
  let skipped = 0
  let failed = 0

  // Nylas attachments (real files, including CID-inline images flagged
  // isInline). Each parsed independently; one failure doesn't block the
  // others.
  for (const ref of parsed.attachments) {
    const result = await parseNylasAttachment(ref, ctx, creds)
    inserted += result.inserted
    skipped += result.skipped
    failed += result.failed
  }

  // Body data-URI images — already-decoded bytes, no Nylas roundtrip.
  for (let i = 0; i < parsed.bodyInlineImages.length; i++) {
    const img = parsed.bodyInlineImages[i]
    const result = await parseNylasInlineImage(img, i, ctx)
    inserted += result.inserted
    skipped += result.skipped
    failed += result.failed
  }

  // Parent row → complete with markdown AFTER its attachments: their text
  // feeds signal extraction (docs/specs/telegram §4.6), so a run must never
  // see a complete root whose children are still missing.
  await markParsed(ctx, parsed.markdown, parsed.analysis, parsed.parserModel)

  return {
    parentStatus: "complete",
    parentMarkdownBytes: byteLengthOf(parsed.markdown),
    childInserted: inserted,
    childSkipped: skipped,
    childFailed: failed,
  }
}

async function parseNylasAttachment(
  ref: NylasAttachmentRef,
  ctx: ParseContext,
  creds: NylasCredentials,
): Promise<ChildOutcome> {
  const attSourceId = `nylas-att:${ctx.externalId}:${ref.attachmentId}`
  const meta = {
    fileName: ref.filename,
    contentType: ref.contentType,
    byteSize: ref.size,
  }

  const kind = detectAttachmentKind(ref.contentType, ref.filename)
  if (!kind) {
    const childId = await insertSkippedChild({
      ctx,
      externalId: attSourceId,
      externalType: "attachment",
      meta,
      reason: "unsupported type",
    })
    // Documents (Q1): a file the parsers cannot read (archive, legacy .xls,
    // …) is still a document — keep its original. Inline (cid:) parts of an
    // unsupported type are mail chrome (GIF logos …), never stored. Best
    // effort: a failed download only leaves the file for the lazy re-fetch.
    if (!ref.isInline && ref.size <= DOCUMENT_MAX_BYTES) {
      try {
        const buffer = await getNylasClient(creds).attachments.downloadBytes({
          identifier: creds.grantId,
          attachmentId: ref.attachmentId,
          queryParams: { messageId: ctx.externalId },
        })
        await storeChildOriginal(ctx, childId, new Uint8Array(buffer), meta)
      } catch (err) {
        console.error(`[parse] downloading unsupported attachment ${attSourceId} failed:`, err)
      }
    }
    return { inserted: 0, skipped: 1, failed: 0 }
  }

  let bytes: Uint8Array
  try {
    const buffer = await getNylasClient(creds).attachments.downloadBytes({
      identifier: creds.grantId,
      attachmentId: ref.attachmentId,
      queryParams: { messageId: ctx.externalId },
    })
    bytes = new Uint8Array(buffer)
  } catch (err) {
    if (isNylasItemMissing(err)) {
      await insertSkippedChild({
        ctx,
        externalId: attSourceId,
        externalType: "attachment",
        meta,
        reason: "no longer exists at provider",
      })
      return { inserted: 0, skipped: 1, failed: 0 }
    }
    await insertFailedChild({
      ctx,
      externalId: attSourceId,
      externalType: "attachment",
      meta,
      reason: err instanceof Error ? err.message : String(err),
    })
    return { inserted: 0, skipped: 0, failed: 1 }
  }

  return runAttachmentParser({
    ctx,
    kind,
    bytes,
    attSourceId,
    externalType: "attachment",
    meta,
    // Nylas delivers cid: inline images as attachments — flag image ones so
    // the decorative triage runs (signature logos / banners / tracking GIFs).
    isInlineImage: kind === "image" && ref.isInline,
  })
}

async function parseNylasInlineImage(
  img: InlineBodyImage,
  index: number,
  ctx: ParseContext,
): Promise<ChildOutcome> {
  return parseInlineImageOrSkip(
    img,
    `nylas-inline:${ctx.externalId}:${index}`,
    ctx,
  )
}

// Shared inline-image flow for the email providers (Nylas + IMAP). Inline
// (cid:) images are mostly decorative chrome — logos, signature graphics,
// social badges, header/footer banners, tracking pixels — that bring no
// content. Two cheap filters drop them before they become source items:
//   1. A header-only dimension/filename triage (no LLM call) catches the
//      obvious junk (tiny icons, thin banners, 1×1 pixels).
//   2. Whatever survives is parsed, and the model's `isBoilerplate` verdict
//      skips high-res logos/banners that slipped past the size gate.
// Either way a skipped image is recorded as an audit row (with the reason in
// parse_error), just kept out of parsed content + discovery. Explicit file
// attachments do NOT go through here — they're treated as intentional.
async function parseInlineImageOrSkip(
  img: InlineBodyImage,
  sid: string,
  ctx: ParseContext,
): Promise<ChildOutcome> {
  const meta = {
    fileName: img.filename,
    contentType: img.mediaType,
    byteSize: img.bytes.byteLength,
  }

  const triage = triageInlineImage(
    { bytes: img.bytes, fileName: img.filename },
    PARSER_CONFIG.image.decorative,
  )
  if (triage.skip) {
    await insertSkippedChild({
      ctx,
      externalId: sid,
      externalType: "inline_image",
      meta,
      reason: triage.reason,
    })
    return { inserted: 0, skipped: 1, failed: 0 }
  }

  try {
    const result = await parseImageBytes({
      bytes: img.bytes,
      fileName: img.filename,
      mediaType: img.mediaType,
      sourceId: sid,
      parentSourceId: ctx.parentNamespacedSourceId,
      sourceSystem: ctx.sourceSystemLabel,
      threadId: ctx.threadExternalId,
      sourceCreatedAt: isoOrNull(ctx.sourceCreatedAt),
      sourceReceivedAt: isoOrNull(ctx.sourceCreatedAt),
    }, ctx.ai)
    if (result.decorative) {
      await insertSkippedChild({
        ctx,
        externalId: sid,
        externalType: "inline_image",
        meta,
        reason: "decorative image (logo/banner/icon)",
      })
      return { inserted: 0, skipped: 1, failed: 0 }
    }
    await insertParsedChild({
      ctx,
      externalId: sid,
      externalType: "inline_image",
      meta,
      markdown: result.markdown,
      analysis: result.analysis,
      parserModel: result.parserModel,
    })
    return { inserted: 1, skipped: 0, failed: 0 }
  } catch (err) {
    return classifyAndInsertChildError({
      ctx,
      externalId: sid,
      externalType: "inline_image",
      meta,
      err,
    })
  }
}

// ── IMAP (email) ──────────────────────────────────────────────────────

async function parseImapItem(ctx: ParseContext): Promise<ParseResult> {
  const creds = getImapCredentials(ctx.sourceId, ctx.credentialsRef)
  // The mailbox folder is denormalised onto each item's metadata_json at
  // sync time (defaults to INBOX if absent on an old row).
  const { mailbox } = imapProviderConfigSchema.parse(ctx.metadataJson)

  const parsed = await parseImapMessage({
    externalId: ctx.externalId,
    mailbox,
    namespacedSourceId: ctx.parentNamespacedSourceId,
    creds,
    ai: ctx.ai,
  })


  await primeOrgAttribution(ctx, parsed.markdown)
  let inserted = 0
  let skipped = 0
  let failed = 0

  // Real attachments — bytes already in hand (mailparser), so no per-file
  // download (unlike Nylas).
  for (let i = 0; i < parsed.attachments.length; i++) {
    const result = await parseImapAttachment(parsed.attachments[i], i, ctx)
    inserted += result.inserted
    skipped += result.skipped
    failed += result.failed
  }

  // Inline (cid:) images that mailparser folded into the HTML as data: URIs.
  for (let i = 0; i < parsed.bodyInlineImages.length; i++) {
    const result = await parseImapInlineImage(parsed.bodyInlineImages[i], i, ctx)
    inserted += result.inserted
    skipped += result.skipped
    failed += result.failed
  }

  // Parent row → complete with markdown AFTER its attachments: their text
  // feeds signal extraction (docs/specs/telegram §4.6), so a run must never
  // see a complete root whose children are still missing.
  await markParsed(ctx, parsed.markdown, parsed.analysis, parsed.parserModel)

  return {
    parentStatus: "complete",
    parentMarkdownBytes: byteLengthOf(parsed.markdown),
    childInserted: inserted,
    childSkipped: skipped,
    childFailed: failed,
  }
}

async function parseImapAttachment(
  att: ImapAttachment,
  index: number,
  ctx: ParseContext,
): Promise<ChildOutcome> {
  const attSourceId = `imap-att:${ctx.externalId}:${index}`
  const meta = {
    fileName: att.filename,
    contentType: att.contentType,
    byteSize: att.bytes.byteLength,
  }

  const kind = detectAttachmentKind(att.contentType, att.filename)
  if (!kind) {
    const childId = await insertSkippedChild({
      ctx,
      externalId: attSourceId,
      externalType: "attachment",
      meta,
      reason: "unsupported type",
    })
    // Documents (Q1): still a document — keep its original (bytes in hand).
    await storeChildOriginal(ctx, childId, att.bytes, meta)
    return { inserted: 0, skipped: 1, failed: 0 }
  }

  return runAttachmentParser({
    ctx,
    kind,
    bytes: att.bytes,
    attSourceId,
    externalType: "attachment",
    meta,
  })
}

async function parseImapInlineImage(
  img: InlineBodyImage,
  index: number,
  ctx: ParseContext,
): Promise<ChildOutcome> {
  return parseInlineImageOrSkip(
    img,
    `imap-inline:${ctx.externalId}:${index}`,
    ctx,
  )
}

// ── Google Chat ───────────────────────────────────────────────────────

async function parseGoogleChatItem(ctx: ParseContext): Promise<ParseResult> {
  const creds = getGchatCredentials(ctx.sourceId, ctx.credentialsRef)
  // parseChatMessage takes the full resource path "spaces/X/messages/Y";
  // sync stores the same in externalId.
  const parsed = await parseChatMessage(ctx.externalId, creds, ctx.ai)

  await primeOrgAttribution(ctx, parsed.markdown)
  let inserted = 0
  let skipped = 0
  let failed = 0
  for (const ref of parsed.attachments) {
    const result = await parseChatAttachment(ref, ctx, creds)
    inserted += result.inserted
    skipped += result.skipped
    failed += result.failed
  }
  // Parent row → complete with markdown AFTER its attachments: their text
  // feeds signal extraction (docs/specs/telegram §4.6), so a run must never
  // see a complete root whose children are still missing.
  await markParsed(ctx, parsed.markdown, parsed.analysis, parsed.parserModel)

  return {
    parentStatus: "complete",
    parentMarkdownBytes: byteLengthOf(parsed.markdown),
    childInserted: inserted,
    childSkipped: skipped,
    childFailed: failed,
  }
}

async function parseChatAttachment(
  ref: ChatAttachmentRef,
  ctx: ParseContext,
  creds: GchatCredentials,
): Promise<ChildOutcome> {
  const messageId = ctx.externalId.split("/").pop() ?? ctx.externalId
  const attSourceId = `gchat-att:${messageId}:${ref.index}`
  const meta = {
    fileName: ref.filename,
    contentType: ref.contentType,
    byteSize: 0,
  }

  const kind = detectAttachmentKind(ref.contentType, ref.filename)
  if (!kind) {
    const childId = await insertSkippedChild({
      ctx,
      externalId: attSourceId,
      externalType: "attachment",
      meta,
      reason: "unsupported type",
    })
    // Documents (Q1): still a document — keep its original. Best effort.
    try {
      const raw = await downloadChatAttachmentBytes(creds, ref.resourceName)
      await storeChildOriginal(ctx, childId, raw, { ...meta, byteSize: raw.byteLength })
    } catch (err) {
      console.error(`[parse] downloading unsupported attachment ${attSourceId} failed:`, err)
    }
    return { inserted: 0, skipped: 1, failed: 0 }
  }

  let bytes: Uint8Array
  try {
    bytes = await downloadChatAttachmentBytes(creds, ref.resourceName)
  } catch (err) {
    if (isGoogleChatItemMissing(err)) {
      await insertSkippedChild({
        ctx,
        externalId: attSourceId,
        externalType: "attachment",
        meta,
        reason: "no longer exists at provider",
      })
      return { inserted: 0, skipped: 1, failed: 0 }
    }
    await insertFailedChild({
      ctx,
      externalId: attSourceId,
      externalType: "attachment",
      meta,
      reason: err instanceof Error ? err.message : String(err),
    })
    return { inserted: 0, skipped: 0, failed: 1 }
  }

  meta.byteSize = bytes.byteLength
  return runAttachmentParser({
    ctx,
    kind,
    bytes,
    attSourceId,
    externalType: "attachment",
    meta,
  })
}

// ── Drop-off (files with a stored original) ──────────────────────────

// A drop-off file whose original is in storage (`file_status = 'stored'`:
// uploads in an entity view, org-level drop-off since documents D1) parses
// like the upload route does: the stored bytes → `parseDropoffFile` → this
// row + the video's audio track as a child. That makes Re-parse work for
// them. Old rows without bytes cannot be parsed again (the user uploads the
// file again). A file above a parser cap / of an unsupported type is kept
// (stored, downloadable) and marked `skipped` with the reason.
async function parseDropoffItem(ctx: ParseContext): Promise<ParseResult> {
  const [row] = await db
    .select({
      filename: sourceItem.filename,
      mimeType: sourceItem.mimeType,
      fileKey: sourceItem.fileKey,
      fileStatus: sourceItem.fileStatus,
      fileMime: sourceItem.fileMime,
      createdAt: sourceItem.createdAt,
    })
    .from(sourceItem)
    .where(eq(sourceItem.id, ctx.itemId))
  if (!row || row.fileStatus !== "stored" || !row.fileKey) {
    throw new Error(
      "Drop-off file has no stored original — upload the file again to analyse it",
    )
  }
  const obj = await getObject(row.fileKey)
  if (!obj) throw new Error("Drop-off file: the stored original is missing in storage")

  const meta = ctx.metadataJson
  const dropoffId =
    typeof meta.dropoffId === "string" && meta.dropoffId
      ? meta.dropoffId
      : ctx.externalId.replace(/^dropoff:/, "")
  const fileName = row.filename ?? "untitled"
  const mediaType = row.mimeType || row.fileMime || obj.contentType || "application/octet-stream"
  let parsed: Awaited<ReturnType<typeof parseDropoffFile>>
  try {
    parsed = await parseDropoffFile({
      bytes: obj.bytes,
      fileName,
      mediaType,
      dropoffId,
      description: typeof meta.description === "string" ? meta.description : "",
      userName: typeof meta.userName === "string" ? meta.userName : undefined,
      uploadedAt: (ctx.sourceCreatedAt ?? row.createdAt).toISOString(),
    }, ctx.ai)
  } catch (err) {
    const tooLarge =
      err instanceof PdfTooLargeError ||
      err instanceof ImageTooLargeError ||
      err instanceof AudioTooLargeError ||
      err instanceof VideoTooLargeError ||
      err instanceof OfficeTooLargeError
    const unsupported =
      err instanceof UnsupportedDropoffTypeError ||
      err instanceof UnsupportedImageTypeError ||
      err instanceof UnsupportedAudioTypeError ||
      err instanceof UnsupportedVideoTypeError ||
      err instanceof UnsupportedOfficeTypeError
    if (!tooLarge && !unsupported) throw err
    const reason = tooLarge ? `too large (${(err as Error).message})` : "unsupported type"
    await db
      .update(sourceItem)
      .set({ parseStatus: "skipped", parseError: reason, parsedAt: new Date() })
      .where(eq(sourceItem.id, ctx.itemId))
    return {
      parentStatus: "skipped",
      parentMarkdownBytes: 0,
      childInserted: 0,
      childSkipped: 0,
      childFailed: 0,
      parentParseError: reason,
    }
  }

  const first = parsed.blocks[0]
  if (!first) throw new Error("Drop-off parser returned no blocks")
  await markParsed(ctx, first.markdown, first.analysis, first.parserModel)

  // Extra blocks become children — currently only video → audio.
  let inserted = 0
  for (let i = 1; i < parsed.blocks.length; i++) {
    const extra = parsed.blocks[i]
    await insertParsedChild({
      ctx,
      externalId: extra.sourceId,
      externalType: extra.kind === "video_audio" ? "derived_audio" : "attachment",
      meta: {
        fileName,
        contentType: extra.kind === "video_audio" ? "audio/mp4" : parsed.mediaType,
        byteSize: 0,
      },
      markdown: extra.markdown,
      analysis: extra.analysis,
      parserModel: extra.parserModel,
    })
    inserted++
  }

  return {
    parentStatus: "complete",
    parentMarkdownBytes: byteLengthOf(first.markdown),
    childInserted: inserted,
    childSkipped: 0,
    childFailed: 0,
  }
}

// ── WhatsApp (chat-group rows) ────────────────────────────────────────

// WhatsApp rows arrive in Pending with the rendered transcript already
// in `metadataJson.rawText` (stamped by the upload route). Parse just
// runs the LLM metadata pass — no remote API to call, no attachment
// children to spawn here (the upload route already inserted attachment
// children inline-parsed under this row's id).
async function parseWhatsAppItem(ctx: ParseContext): Promise<ParseResult> {
  const meta = ctx.metadataJson
  const rawText = typeof meta.rawText === "string" ? meta.rawText : ""
  if (!rawText) {
    throw new Error(
      "WhatsApp chat-group row is missing metadataJson.rawText — re-upload the archive",
    )
  }
  const authors = Array.isArray(meta.authors)
    ? (meta.authors as unknown[]).filter(
        (a): a is string => typeof a === "string",
      )
    : []
  const startTimestamp =
    typeof meta.startTimestamp === "string" ? meta.startTimestamp : null
  const endTimestamp =
    typeof meta.endTimestamp === "string" ? meta.endTimestamp : null

  const parsed = await parseWhatsAppGroup({
    rawText,
    sourceId: ctx.parentNamespacedSourceId,
    threadId: ctx.threadExternalId,
    authors,
    startTimestamp,
    endTimestamp,
  }, ctx.ai)

  await markParsed(ctx, parsed.markdown, parsed.analysis, parsed.parserModel)

  return {
    parentStatus: "complete",
    parentMarkdownBytes: byteLengthOf(parsed.markdown),
    childInserted: 0,
    childSkipped: 0,
    childFailed: 0,
  }
}

// ── Telegram (DM text rows) ───────────────────────────────────────────

// Telegram rows arrive in Pending with the message body already in
// `metadata_json.rawText` (stamped by the webhook ingest). Like WhatsApp,
// parse is a pure local render + one LLM metadata pass — no remote API to
// call. Phase 1 produces no children (attachments land in Phase 2).
/**
 * The author of a Telegram item by the ONE rule (docs/specs/telegram/04 §8):
 * loads the org's directory once per parse; a member found by a binding id
 * makes the attribution `own_org` (rule 1d0). Best effort.
 */
async function prepareTelegramIdentity(ctx: ParseContext): Promise<void> {
  if (!ctx.organizationId) return
  try {
    ctx.telegramDirectory = await loadTelegramDirectory(ctx.organizationId)
    const { resolved } = resolveTelegramMessage(resolveInputOf(ctx.metadataJson), ctx.telegramDirectory)
    ctx.telegramStaffVia = resolved.author.kind === "member" && resolved.author.via === "staff_binding" ? "staff_binding" : null
    ctx.telegramAllInternal = !!resolved.internal && resolved.author.kind === "member" && !resolved.forward
  } catch (err) {
    console.warn(`[parse] telegram identity of ${ctx.itemId} failed:`, err)
  }
}

/** After the parse: store `metadata_json.telegram.resolved` + learn ids (§6.2). Best effort. */
async function finishTelegramIdentity(ctx: ParseContext, groupPeer: TgPerson | null): Promise<void> {
  if (!ctx.organizationId) return
  try {
    await stampTelegramResolved(ctx.organizationId, ctx.itemId, ctx.metadataJson, ctx.telegramDirectory, groupPeer)
  } catch (err) {
    console.warn(`[parse] telegram resolution of ${ctx.itemId} failed:`, err)
  }
}

async function parseTelegramItem(ctx: ParseContext): Promise<ParseResult> {
  const meta = ctx.metadataJson
  await prepareTelegramIdentity(ctx)

  // Voice / audio message: the bytes aren't in the DB — re-resolve them from
  // the stored Telegram `file_id` and run them through the audio parser. The
  // transcript becomes this row's parsed markdown directly (a Telegram DM is a
  // single message = a single source_item, so there's no child to spawn).
  const media = extractTelegramMediaMeta(meta)
  if (media) {
    return await parseTelegramVoiceItem(ctx, media)
  }

  const files = readTelegramFileRefs(meta)
  // A file message without a caption → «Файл: <name>» so the root parses.
  const rawText =
    (typeof meta.rawText === "string" ? meta.rawText : "") || (files.length > 0 ? fileOnlyMessageText(files) : "")
  if (!rawText) {
    throw new Error(
      "Telegram message row is missing metadata_json.rawText — re-ingest the message",
    )
  }
  const sender = Array.isArray(meta.senders)
    ? (meta.senders as unknown[]).find(
        (s): s is string => typeof s === "string" && s.length > 0,
      ) ?? "Telegram user"
    : "Telegram user"

  const parsed = await parseTelegramMessage({
    rawText,
    sourceId: ctx.parentNamespacedSourceId,
    sender,
    threadId: ctx.threadExternalId,
    sourceCreatedAt: ctx.sourceCreatedAt
      ? ctx.sourceCreatedAt.toISOString()
      : null,
  }, ctx.ai)

  // Files (docs/specs/telegram §4.2): the children are inserted BEFORE the
  // root is marked complete, so a signal run never sees a complete root
  // whose files are not parsed yet (their text feeds extraction, Q8). Same
  // attachment path as mail / Google Chat; they inherit the root's
  // attribution (primed first).
  await primeOrgAttribution(ctx, parsed.markdown)
  let childInserted = 0
  let childSkipped = 0
  let childFailed = 0
  if (files.length > 0) {
    const tg = (meta.telegram ?? {}) as Record<string, unknown>
    const chatId = typeof tg.chatId === "number" || typeof tg.chatId === "string" ? tg.chatId : ctx.threadExternalId ?? "chat"
    const messageId = typeof tg.messageId === "number" || typeof tg.messageId === "string" ? tg.messageId : ctx.externalId
    const creds = getTelegramCredentials(ctx.sourceId, ctx.credentialsRef)
    for (let i = 0; i < files.length; i++) {
      const r = await parseTelegramFile(ctx, creds.botToken, files[i], telegramFileExternalId(chatId, messageId, i))
      childInserted += r.inserted
      childSkipped += r.skipped
      childFailed += r.failed
    }
  }

  await markParsed(ctx, parsed.markdown, parsed.analysis, parsed.parserModel)
  const groupPeer = await stampTelegramGroupPeer(ctx)
  await finishTelegramIdentity(ctx, groupPeer)

  return {
    parentStatus: "complete",
    parentMarkdownBytes: byteLengthOf(parsed.markdown),
    childInserted,
    childSkipped,
    childFailed,
  }
}

// G5 (docs/specs/telegram §6): in a GROUP, a message of ours has no
// recipient — its counterparty is the client side of the group. Stamp
// `metadata_json.telegram.groupPeer` = the author of the latest earlier
// non-own message of the same chat (≤ 7 days), so the topics matcher uses it
// like the first recipient of an outbound mail. Best effort.
async function stampTelegramGroupPeer(ctx: ParseContext): Promise<TgPerson | null> {
  try {
    const tg = (ctx.metadataJson.telegram ?? {}) as Record<string, unknown>
    if (tg.chatType !== "group" && tg.chatType !== "supergroup") return null
    const [self] = await db
      .select({ attribution: sourceItem.orgAttribution, at: sourceItem.sourceCreatedAt })
      .from(sourceItem)
      .where(eq(sourceItem.id, ctx.itemId))
    if (!self || self.attribution !== "own_org" || !ctx.threadExternalId) return null
    const at = self.at ?? new Date()
    const [prev] = await db
      .select({ meta: sourceItem.metadataJson })
      .from(sourceItem)
      .where(
        and(
          eq(sourceItem.sourceId, ctx.sourceId),
          eq(sourceItem.threadExternalId, ctx.threadExternalId),
          isNull(sourceItem.parentSourceItemId),
          ne(sourceItem.id, ctx.itemId),
          ne(sourceItem.orgAttribution, "own_org"),
          lte(sourceItem.sourceCreatedAt, at),
          gte(sourceItem.sourceCreatedAt, new Date(at.getTime() - 7 * 86_400_000)),
        ),
      )
      .orderBy(desc(sourceItem.sourceCreatedAt))
      .limit(1)
    const from = ((prev?.meta as Record<string, unknown> | undefined)?.telegram as Record<string, unknown> | undefined)?.from
    if (!from || typeof from !== "object") return null
    await db
      .update(sourceItem)
      .set({ metadataJson: sql`jsonb_set(${sourceItem.metadataJson}, '{telegram,groupPeer}', ${JSON.stringify(from)}::jsonb, true)` })
      .where(eq(sourceItem.id, ctx.itemId))
    const f = from as { id?: number | string; username?: string | null; firstName?: string | null; lastName?: string | null }
    return { id: f.id != null ? String(f.id) : null, username: f.username ?? null, name: [f.firstName, f.lastName].filter(Boolean).join(" ") || null }
  } catch (err) {
    console.warn(`[parse] telegram group peer of ${ctx.itemId} failed:`, err)
    return null
  }
}

// One Telegram file → a child attachment (docs/specs/telegram §4.2). A file
// above the 20 MB bot limit is listed (`too_large`, not downloadable, Q6);
// otherwise downloaded by `file_id` and handed to `runAttachmentParser`
// (parsed child + stored original; unsupported type / above a parser cap =
// stored + skipped with the reason, exactly as for mail). A download error =
// a failed child (re-parse retries; `file_id` stays valid for this bot).
async function parseTelegramFile(
  ctx: ParseContext,
  botToken: string,
  file: TelegramFileRef,
  attSourceId: string,
): Promise<ChildOutcome> {
  const meta: AttachmentMeta = { fileName: file.fileName, contentType: file.mimeType, byteSize: file.fileSize ?? 0 }
  if (isTooLargeForBot(file)) {
    const childId = await insertSkippedChild({
      ctx,
      externalId: attSourceId,
      externalType: "attachment",
      meta,
      reason: "больше 20 МБ — Telegram не отдаёт такие файлы боту",
    })
    await db.update(sourceItem).set({ fileStatus: "too_large", fileSizeBytes: file.fileSize }).where(eq(sourceItem.id, childId))
    return { inserted: 0, skipped: 1, failed: 0 }
  }
  let bytes: Uint8Array
  try {
    bytes = (await downloadTelegramFile(botToken, file.fileId)).bytes
  } catch (err) {
    await insertFailedChild({
      ctx,
      externalId: attSourceId,
      externalType: "attachment",
      meta,
      reason: err instanceof Error ? err.message : String(err),
    })
    return { inserted: 0, skipped: 0, failed: 1 }
  }
  meta.byteSize = bytes.byteLength
  const kind = detectAttachmentKind(file.mimeType, file.fileName)
  if (!kind) {
    // Not a parser type (zip, legacy .xls, HEIC …): kept as a document (Q1 of the
    // documents spec) — listed and downloadable, «формат не поддерживается».
    const childId = await insertSkippedChild({ ctx, externalId: attSourceId, externalType: "attachment", meta, reason: "unsupported type" })
    await storeChildOriginal(ctx, childId, bytes, meta)
    return { inserted: 0, skipped: 1, failed: 0 }
  }
  return runAttachmentParser({ ctx, kind, bytes, attSourceId, externalType: "attachment", meta })
}

// The voice/audio descriptor ingest stamps onto a Telegram row's
// `metadata_json.telegram.media`. Returns null for plain text messages.
type TelegramMediaMeta = {
  fileId: string
  mimeType: string
  fileName: string
}

function extractTelegramMediaMeta(
  meta: Record<string, unknown>,
): TelegramMediaMeta | null {
  const telegram = meta.telegram as Record<string, unknown> | undefined
  const media = telegram?.media as Record<string, unknown> | undefined
  if (!media || typeof media.fileId !== "string") return null
  return {
    fileId: media.fileId,
    mimeType: typeof media.mimeType === "string" ? media.mimeType : "audio/ogg",
    fileName:
      typeof media.fileName === "string" ? media.fileName : "telegram-voice.ogg",
  }
}

// Transcribe a Telegram voice/audio message. Downloads the bytes via the
// stored `file_id` (re-resolvable, so this is safe on a re-parse too) using
// the per-source bot token, then runs the universal audio parser. The
// transcript replaces this row's parsed markdown — same shape as the text
// path, so cards / deals / discovery treat it identically downstream.
async function parseTelegramVoiceItem(
  ctx: ParseContext,
  media: TelegramMediaMeta,
): Promise<ParseResult> {
  await prepareTelegramIdentity(ctx)
  const creds = getTelegramCredentials(ctx.sourceId, ctx.credentialsRef)
  const { bytes } = await downloadTelegramFile(creds.botToken, media.fileId)

  const parsed = await parseAudioBytes({
    bytes,
    fileName: media.fileName,
    mediaType: media.mimeType,
    sourceId: ctx.parentNamespacedSourceId,
    parentSourceId: null,
    sourceSystem: ctx.sourceSystemLabel,
    threadId: ctx.threadExternalId,
    sourceCreatedAt: isoOrNull(ctx.sourceCreatedAt),
    sourceReceivedAt: isoOrNull(ctx.sourceCreatedAt),
  }, ctx.ai)

  // Backfill the message body with the transcript. At ingest a voice note has
  // no usable text — `rawText`/`text` were set to the (usually empty) caption —
  // so consumers that read the raw body (e.g. the `new_order` card's verbatim
  // `orderRequest`) would otherwise fall back to the whole parsed markdown.
  // Keep any real caption as a prefix for context.
  const caption =
    typeof ctx.metadataJson.rawText === "string"
      ? ctx.metadataJson.rawText.trim()
      : ""
  const body =
    caption && parsed.transcript
      ? `${caption}\n\n${parsed.transcript}`
      : parsed.transcript || caption
  const metadataPatch = body ? { rawText: body, text: body } : undefined

  await markParsed(
    ctx,
    parsed.markdown,
    parsed.analysis,
    parsed.parserModel,
    metadataPatch,
  )
  await finishTelegramIdentity(ctx, await stampTelegramGroupPeer(ctx))

  return {
    parentStatus: "complete",
    parentMarkdownBytes: byteLengthOf(parsed.markdown),
    childInserted: 0,
    childSkipped: 0,
    childFailed: 0,
  }
}

// ── Google Drive ──────────────────────────────────────────────────────

async function parseGoogleDriveItem(ctx: ParseContext): Promise<ParseResult> {
  const creds = getGdriveCredentials(ctx.sourceId, ctx.credentialsRef)
  const orgId = ctx.organizationId
  const parsed = await parseDriveFile(ctx.externalId, creds, ctx.ai, {
    // Documents (Q1): the file's original, stored before the parse so a file
    // above a parser cap is kept too. Never changes the parse result.
    onOriginal: orgId
      ? async (o) => {
          const { storeRootOriginal } = await import("@/server/documents-ingest")
          await storeRootOriginal(orgId, ctx.itemId, o.bytes, { name: o.name, mime: o.mime })
        }
      : undefined,
  })
  // First block is the body (the file itself); video files emit a
  // second block (audio transcript) that becomes a child.
  if (parsed.blocks.length === 0) {
    throw new Error("Drive parser returned no blocks")
  }

  const bodyBlock = parsed.blocks[0]
  await markParsed(
    ctx,
    bodyBlock.markdown,
    bodyBlock.analysis,
    bodyBlock.parserModel,
  )

  let inserted = 0
  for (let i = 1; i < parsed.blocks.length; i++) {
    const extra = parsed.blocks[i]
    const childExternalId = `drive:${ctx.externalId}:${extra.kind === "video_audio" ? "audio" : `extra-${i}`}`
    await insertParsedChild({
      ctx,
      externalId: childExternalId,
      externalType: extra.kind === "video_audio" ? "derived_audio" : "attachment",
      meta: {
        fileName: parsed.fileName,
        contentType: extra.kind === "video_audio" ? "audio/mp4" : parsed.mimeType,
        byteSize: 0,
      },
      markdown: extra.markdown,
      analysis: extra.analysis,
      parserModel: extra.parserModel,
    })
    inserted++
  }

  return {
    parentStatus: "complete",
    parentMarkdownBytes: byteLengthOf(bodyBlock.markdown),
    childInserted: inserted,
    childSkipped: 0,
    childFailed: 0,
  }
}

// ── Shared attachment parser dispatch ────────────────────────────────

type ChildOutcome = { inserted: number; skipped: number; failed: number }

type AttachmentMeta = {
  fileName: string
  contentType: string
  byteSize: number
}

type RunAttachmentInput = {
  ctx: ParseContext
  kind: "pdf" | "image" | "audio" | "video" | "office"
  bytes: Uint8Array
  attSourceId: string
  externalType: SourceItemKind
  meta: AttachmentMeta
  // True when this is an INLINE (cid:) email image — Nylas surfaces those as
  // attachments with `isInline: true`. Such images get the decorative triage
  // (logo / banner / icon / tracking-pixel filter); explicit file attachments
  // do not. See `parseInlineImageOrSkip` for the matching data-URI path.
  isInlineImage?: boolean
}

// Parse one attachment into its child row(s), then — documents (Q1,
// docs/specs/attachments §3.2) — store its original bytes on the child,
// whatever the parse outcome (parsed, skipped as too large / unsupported,
// failed): the file is a document either way. Never for a decorative inline
// image (not a document, Q2) or WhatsApp (Q13). Storing never changes the
// parse result.
async function runAttachmentParser(
  input: RunAttachmentInput,
): Promise<ChildOutcome> {
  const r = await parseAttachmentChild(input)
  if (!r.decorative) {
    await storeChildOriginal(input.ctx, r.childId, input.bytes, input.meta)
  }
  return { inserted: r.inserted, skipped: r.skipped, failed: r.failed }
}

type AttachmentChildResult = ChildOutcome & {
  // The attachment's own child row (the video row for a video; its audio
  // track is a grandchild).
  childId: string | null
  // Skipped as a decorative inline image (logo / banner / pixel).
  decorative: boolean
}

async function parseAttachmentChild(
  input: RunAttachmentInput,
): Promise<AttachmentChildResult> {
  const { ctx, kind, bytes, attSourceId, externalType, meta } = input
  const commonInput = {
    sourceId: attSourceId,
    parentSourceId: ctx.parentNamespacedSourceId,
    sourceSystem: ctx.sourceSystemLabel,
    threadId: ctx.threadExternalId,
    sourceCreatedAt: isoOrNull(ctx.sourceCreatedAt),
    sourceReceivedAt: isoOrNull(ctx.sourceCreatedAt),
  }
  const parsedOne = (childId: string): AttachmentChildResult => ({
    inserted: 1,
    skipped: 0,
    failed: 0,
    childId,
    decorative: false,
  })

  try {
    if (kind === "pdf") {
      const r = await parsePdfBytes({
        ...commonInput,
        bytes,
        fileName: meta.fileName,
      }, ctx.ai)
      return parsedOne(
        await insertParsedChild({
          ctx,
          externalId: attSourceId,
          externalType,
          meta,
          markdown: r.markdown,
          analysis: r.analysis,
          parserModel: r.parserModel,
        }),
      )
    }
    if (kind === "audio") {
      const r = await parseAudioBytes({
        ...commonInput,
        bytes,
        fileName: meta.fileName,
        mediaType: resolveMediaType(meta.contentType, "audio/mpeg"),
      }, ctx.ai)
      return parsedOne(
        await insertParsedChild({
          ctx,
          externalId: attSourceId,
          externalType,
          meta,
          markdown: r.markdown,
          analysis: r.analysis,
          parserModel: r.parserModel,
        }),
      )
    }
    if (kind === "video") {
      const audioSourceId = `${attSourceId}:audio`
      const r = await parseVideoBytes({
        bytes,
        fileName: meta.fileName,
        mediaType: resolveMediaType(meta.contentType, "video/mp4"),
        sourceSystem: ctx.sourceSystemLabel,
        threadId: ctx.threadExternalId,
        sourceCreatedAt: isoOrNull(ctx.sourceCreatedAt),
        sourceReceivedAt: isoOrNull(ctx.sourceCreatedAt),
        videoSourceId: attSourceId,
        videoParentSourceId: ctx.parentNamespacedSourceId,
        audioSourceId,
        // The audio block's parent is the video, not the email/chat.
        audioParentSourceId: attSourceId,
      }, ctx.ai)
      // Insert the video block first so it can be referenced as the
      // parent of the audio derivation.
      const videoChildId = await insertParsedChild({
        ctx,
        externalId: attSourceId,
        externalType,
        meta,
        markdown: r.videoMarkdown,
        analysis: r.videoAnalysis,
        parserModel: r.parserModel,
      })
      await insertParsedChild({
        ctx,
        externalId: audioSourceId,
        externalType: "derived_audio",
        meta: { ...meta, contentType: "audio/mp4" },
        markdown: r.audioMarkdown,
        analysis: r.audioAnalysis,
        parserModel: r.parserModel,
        parentSourceItemIdOverride: videoChildId,
      })
      return { inserted: 2, skipped: 0, failed: 0, childId: videoChildId, decorative: false }
    }
    if (kind === "office") {
      const format = detectOfficeFormat(meta.contentType, meta.fileName)
      if (!format) {
        const childId = await insertSkippedChild({
          ctx,
          externalId: attSourceId,
          externalType,
          meta,
          reason: "unsupported type",
        })
        return { inserted: 0, skipped: 1, failed: 0, childId, decorative: false }
      }
      const r = await parseOfficeBytes({
        ...commonInput,
        bytes,
        fileName: meta.fileName,
        mediaType: resolveMediaType(meta.contentType, officeMediaType(format)),
      }, ctx.ai)
      return parsedOne(
        await insertParsedChild({
          ctx,
          externalId: attSourceId,
          externalType,
          meta,
          markdown: r.markdown,
          analysis: r.analysis,
          parserModel: r.parserModel,
        }),
      )
    }
    // image — inline (cid:) images get the decorative pre-filter; explicit
    // attachments are treated as intentional content and parsed as-is.
    if (input.isInlineImage) {
      const triage = triageInlineImage(
        { bytes, fileName: meta.fileName },
        PARSER_CONFIG.image.decorative,
      )
      if (triage.skip) {
        const childId = await insertSkippedChild({
          ctx,
          externalId: attSourceId,
          externalType,
          meta,
          reason: triage.reason,
        })
        return { inserted: 0, skipped: 1, failed: 0, childId, decorative: true }
      }
    }
    const r = await parseImageBytes({
      ...commonInput,
      bytes,
      fileName: meta.fileName,
      mediaType: resolveMediaType(
        meta.contentType,
        inferImageMediaType(meta.fileName),
      ),
    }, ctx.ai)
    if (input.isInlineImage && r.decorative) {
      const childId = await insertSkippedChild({
        ctx,
        externalId: attSourceId,
        externalType,
        meta,
        reason: "decorative image (logo/banner/icon)",
      })
      return { inserted: 0, skipped: 1, failed: 0, childId, decorative: true }
    }
    return parsedOne(
      await insertParsedChild({
        ctx,
        externalId: attSourceId,
        externalType,
        meta,
        markdown: r.markdown,
        analysis: r.analysis,
        parserModel: r.parserModel,
      }),
    )
  } catch (err) {
    const r = await classifyAndInsertChildError({
      ctx,
      externalId: attSourceId,
      externalType,
      meta,
      err,
    })
    return { ...r, decorative: false }
  }
}

// Documents: store the original bytes of an attachment child (Q1). Never
// throws; a no-op without an organization and for WhatsApp (Q13 — its files
// are listed without bytes).
async function storeChildOriginal(
  ctx: ParseContext,
  childId: string | null,
  bytes: Uint8Array,
  meta: AttachmentMeta,
): Promise<void> {
  if (!childId || !ctx.organizationId || ctx.provider === "whatsapp") return
  try {
    const { storeDocumentOriginal } = await import("@/server/documents-ingest")
    await storeDocumentOriginal(ctx.organizationId, childId, bytes, {
      name: meta.fileName,
      mime: meta.contentType,
    })
  } catch (err) {
    console.error(`[parse] storing the original of ${childId} failed:`, err)
  }
}

async function classifyAndInsertChildError(args: {
  ctx: ParseContext
  externalId: string
  externalType: SourceItemKind
  meta: AttachmentMeta
  err: unknown
}): Promise<ChildOutcome & { childId: string }> {
  const { err } = args
  if (
    err instanceof PdfTooLargeError ||
    err instanceof ImageTooLargeError ||
    err instanceof AudioTooLargeError ||
    err instanceof VideoTooLargeError ||
    err instanceof OfficeTooLargeError
  ) {
    const childId = await insertSkippedChild({
      ...args,
      reason: `too large (${err.message})`,
    })
    return { inserted: 0, skipped: 1, failed: 0, childId }
  }
  if (
    err instanceof UnsupportedImageTypeError ||
    err instanceof UnsupportedAudioTypeError ||
    err instanceof UnsupportedVideoTypeError ||
    err instanceof UnsupportedOfficeTypeError
  ) {
    const childId = await insertSkippedChild({ ...args, reason: "unsupported type" })
    return { inserted: 0, skipped: 1, failed: 0, childId }
  }
  const childId = await insertFailedChild({
    ...args,
    reason: err instanceof Error ? err.message : String(err),
  })
  return { inserted: 0, skipped: 0, failed: 1, childId }
}

// ── DB writes ────────────────────────────────────────────────────────

// Parents only — classify authorship (refs/org-attribution.md). Bails to
// `unknown` with no org. The deterministic path short-circuits for email/chat
// with a resolvable sender; only ambiguous documents reach the LLM judge.
/** The root's attribution computed BEFORE its children are inserted (they inherit it). */
async function primeOrgAttribution(ctx: ParseContext, markdown: string): Promise<void> {
  const a = await computeOrgAttribution(ctx, markdown)
  ctx.primedAttribution = a
  ctx.orgAttributionValue = a.value
}

async function computeOrgAttribution(
  ctx: ParseContext,
  markdown: string,
): Promise<OrgAttributionResult> {
  if (!ctx.organizationId) {
    return { value: "unknown", confidence: "low", matchedOn: [], reason: "No organization" }
  }
  const ownCtx = ctx.ownCtx ?? (await getOwnOrgContext(ctx.organizationId))
  const orgIdentity = orgIdentityFromContext(ownCtx)
  const authorEmails = extractAuthorEmails(ctx.metadataJson, ctx.provider)
  const result = await resolveOrgAttribution({
    authorEmails,
    authorTelegram: extractAuthorTelegramHandle(ctx.metadataJson),
    authorTelegramStaffVia: ctx.telegramStaffVia ?? null,
    contentHaystack: markdown,
    orgIdentity,
    organizationId: ctx.organizationId,
    // WhatsApp transcripts are conversational — authorship is meaningless, so
    // never pay for the judge there.
    enableLlmJudge: ctx.provider !== "whatsapp",
  }, ctx.ai)
  // Identity spec Q9: author AND every recipient ours → internal mail
  // (stored as metadata_json.orgAttribution.allInternal; signal extraction
  // then fixes the direction to `internal` without the model). A forward is
  // never «internal»: its real author is the ORIGINAL sender (topics §5.3).
  const subject = typeof ctx.metadataJson.subject === "string" ? ctx.metadataJson.subject : null
  const allInternal =
    result.value === "own_org" &&
    (ctx.telegramAllInternal === true ||
      (!detectForward(markdown, subject).isForward &&
        computeAllInternal(
          ctx.metadataJson,
          (e) => ownCtx.matchEmail(e) !== null,
        )))
  return { ...result, allInternal }
}

async function markParsed(
  ctx: ParseContext,
  markdown: string,
  analysis: MetadataAnalysis,
  // Model that actually produced `analysis` (from the parser result).
  parserModel: string | null,
  // Optional extra fields to fold into metadata_json at parse time. Used by the
  // Telegram voice path to backfill `rawText`/`text` with the transcript (the
  // bytes carried no usable body text at ingest — see `parseTelegramVoiceItem`).
  metadataPatch?: Record<string, unknown>,
): Promise<void> {
  const cleaned = filterAnalysisOwnOrg(analysis, ctx.ownOrg)
  const attribution = ctx.primedAttribution ?? (await computeOrgAttribution(ctx, markdown))
  // Children created after this read inherit the verdict via ctx.
  ctx.orgAttributionValue = attribution.value
  // Merge the LLM analysis (+ the attribution evidence) into the existing
  // metadata_json (which holds provider-shape sync fields like
  // subject/snippet/from/to). jsonb `||` is right-biased so analysis keys
  // overwrite any colliding sync keys (none today, but defensive).
  const merged = { ...cleaned, orgAttribution: attribution, ...metadataPatch }
  await db
    .update(sourceItem)
    .set({
      parseStatus: "complete",
      parsedAt: new Date(),
      parserModel,
      parsedMarkdown: markdown,
      parseError: null,
      orgAttribution: attribution.value,
      metadataJson: sql`COALESCE(${sourceItem.metadataJson}, '{}'::jsonb) || ${JSON.stringify(merged)}::jsonb`,
    })
    .where(eq(sourceItem.id, ctx.itemId))
}

async function insertParsedChild(args: {
  ctx: ParseContext
  externalId: string
  externalType: SourceItemKind
  meta: AttachmentMeta
  markdown: string
  analysis: MetadataAnalysis
  // Model that actually produced `analysis` (from the parser result).
  parserModel: string | null
  parentSourceItemIdOverride?: string
}): Promise<string> {
  const id = randomUUID()
  const now = new Date()
  const cleaned = filterAnalysisOwnOrg(args.analysis, args.ctx.ownOrg)
  // Children are synthesized rows — they have no provider sync metadata to
  // preserve, so we write the analysis as the entire metadata_json.
  const inserted = await db
    .insert(sourceItem)
    .values({
      id,
      sourceId: args.ctx.sourceId,
      organizationId: args.ctx.organizationId,
      externalId: args.externalId,
      externalType: args.externalType,
      parentSourceItemId: args.parentSourceItemIdOverride ?? args.ctx.itemId,
      threadExternalId: args.ctx.threadExternalId,
      filename: args.meta.fileName,
      mimeType: args.meta.contentType,
      sizeBytes: args.meta.byteSize || null,
      sourceCreatedAt: args.ctx.sourceCreatedAt,
      fetchedAt: now,
      parseStatus: "complete",
      parsedAt: now,
      parserModel: args.parserModel,
      parsedMarkdown: args.markdown,
      // Children inherit the parent's authorship verdict (set on ctx during the
      // parent's markParsed, which always runs before children are inserted).
      orgAttribution: args.ctx.orgAttributionValue ?? "unknown",
      metadataJson: cleaned,
    })
    .onConflictDoUpdate({
      target: [sourceItem.sourceId, sourceItem.externalId],
      set: {
        parseStatus: "complete",
        parsedAt: now,
        parserModel: args.parserModel,
        parsedMarkdown: args.markdown,
        parseError: null,
        filename: args.meta.fileName,
        mimeType: args.meta.contentType,
        sizeBytes: args.meta.byteSize || null,
        orgAttribution: args.ctx.orgAttributionValue ?? "unknown",
        metadataJson: sql`COALESCE(${sourceItem.metadataJson}, '{}'::jsonb) || ${JSON.stringify(cleaned)}::jsonb`,
      },
    })
    .returning({ id: sourceItem.id })
  // On a conflict (same source + external id) the existing row is updated
  // and keeps its id — return that one, not the unused fresh uuid.
  return inserted[0]?.id ?? id
}

async function insertSkippedChild(args: {
  ctx: ParseContext
  externalId: string
  externalType: SourceItemKind
  meta: AttachmentMeta
  reason: string
}): Promise<string> {
  return insertChildWithStatus(args, "skipped", args.reason)
}

async function insertFailedChild(args: {
  ctx: ParseContext
  externalId: string
  externalType: SourceItemKind
  meta: AttachmentMeta
  reason: string
}): Promise<string> {
  return insertChildWithStatus(args, "failed", args.reason)
}

async function insertChildWithStatus(
  args: {
    ctx: ParseContext
    externalId: string
    externalType: SourceItemKind
    meta: AttachmentMeta
  },
  status: ParseStatus,
  reason: string,
): Promise<string> {
  const id = randomUUID()
  const now = new Date()
  const inserted = await db
    .insert(sourceItem)
    .values({
      id,
      sourceId: args.ctx.sourceId,
      organizationId: args.ctx.organizationId,
      externalId: args.externalId,
      externalType: args.externalType,
      parentSourceItemId: args.ctx.itemId,
      threadExternalId: args.ctx.threadExternalId,
      filename: args.meta.fileName,
      mimeType: args.meta.contentType,
      sizeBytes: args.meta.byteSize || null,
      sourceCreatedAt: args.ctx.sourceCreatedAt,
      fetchedAt: now,
      parseStatus: status,
      parsedAt: now,
      parseError: reason,
    })
    .onConflictDoUpdate({
      target: [sourceItem.sourceId, sourceItem.externalId],
      set: {
        parseStatus: status,
        parsedAt: now,
        parseError: reason,
      },
    })
    .returning({ id: sourceItem.id })
  return inserted[0]?.id ?? id
}

// ── Helpers ──────────────────────────────────────────────────────────

function detectAttachmentKind(
  contentType: string,
  filename: string,
): "pdf" | "image" | "audio" | "video" | "office" | null {
  const ct = (contentType ?? "").toLowerCase()
  const fn = (filename ?? "").toLowerCase()
  if (ct === "application/pdf" || fn.endsWith(".pdf")) return "pdf"
  if (isSupportedVideoType(ct, fn)) return "video"
  if (isSupportedAudioType(ct, fn)) return "audio"
  if (isSupportedImageType(ct, fn)) return "image"
  if (isSupportedOfficeType(ct, fn)) return "office"
  return null
}

function resolveMediaType(contentType: string, fallback: string): string {
  return contentType && contentType !== "application/octet-stream"
    ? contentType
    : fallback
}

function inferImageMediaType(filename: string): string {
  return filename.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg"
}

function isoOrNull(d: Date | null): string | null {
  return d ? d.toISOString() : null
}

function byteLengthOf(s: string): number {
  return new TextEncoder().encode(s).byteLength
}
