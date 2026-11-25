import "server-only"
import { Output } from "ai"
import { aiGenerateText } from "@/server/ai/runtime"
import { z } from "zod"
import { getDriveClient } from "@/lib/google-drive"
import type { GdriveCredentials } from "@/server/providers/handlers"
import {
  assembleMarkdown,
  buildFrontmatter,
  DEFAULT_RELEVANCE,
  extractUrls,
  filterMentionedPeople,
  MENTIONED_PEOPLE_PROMPT,
  mentionedPersonSchema,
  uniqueStrings,
  servedModel,
  type MetadataAnalysis,
  type ParserAiContext,
  type SourceFrontmatter,
  parserCallContext,
  withOwnOrgLine,
} from "@/server/parsers/_shared"
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
  OfficeTooLargeError,
  UnsupportedOfficeTypeError,
} from "@/server/parsers/office"

// ── Google-native mimes ──────────────────────────────────────────────

const GOOGLE_DOCS_MIME = "application/vnd.google-apps.document"
const GOOGLE_SHEETS_MIME = "application/vnd.google-apps.spreadsheet"
const GOOGLE_SLIDES_MIME = "application/vnd.google-apps.presentation"
const GOOGLE_FOLDER_MIME = "application/vnd.google-apps.folder"
const GOOGLE_FORM_MIME = "application/vnd.google-apps.form"
const GOOGLE_SHORTCUT_MIME = "application/vnd.google-apps.shortcut"
const GOOGLE_DRAWING_MIME = "application/vnd.google-apps.drawing"

// How many data rows of a Google Sheet to show in the parsed output.
// Full export is only used for detection + row count; the Content block
// only includes this many sample rows plus headers.
const SHEETS_PREVIEW_ROWS = 10

// ── Schemas ──────────────────────────────────────────────────────────

// Lean schema for when the body is already structured/provided (Docs
// markdown export, Sheets CSV preview). We only ask the LLM for the
// content-derived fields.
const metadataOnlySchema = z.object({
  language: z
    .string()
    .describe(
      "ISO 639-1 two-letter language code of the dominant text (e.g. 'en', 'de'). Default to 'en' if uncertain.",
    ),
  summary: z
    .string()
    .describe("A concise 1-3 sentence summary of what the document is about. Write this summary in Russian regardless of the source language."),
  mentions: z
    .array(z.string())
    .describe(
      "Names of every person mentioned by name anywhere in the document.",
    ),
  companies: z
    .array(z.string())
    .describe("Names of companies or brands mentioned."),
  products: z
    .array(z.string())
    .describe("Names of products mentioned."),
  mentionedPeople: z
    .array(mentionedPersonSchema)
    .describe(
      "People referenced in the document body beyond the file owner (third parties named in the text). See the system prompt for emission rules.",
    ),
})

// ── Block + result shapes ────────────────────────────────────────────

export type DriveBlockKind =
  | "docs"
  | "slides"
  | "sheets"
  | "pdf"
  | "image"
  | "audio"
  | "video"
  | "video_audio"
  | "docx"
  | "pptx"
  | "xlsx"
  | "csv"

export type DriveBlock = {
  kind: DriveBlockKind
  sourceId: string
  markdown: string
  analysis: MetadataAnalysis
  // Model that produced this block (→ source_item.parser_model).
  parserModel: string | null
}

/**
 * The file's bytes as the parser saw them — the stored original of a
 * document (docs/specs/attachments §3.2). Google-native files are the same
 * export the parser reads: Docs → Markdown, Sheets → CSV, Slides → .pptx.
 */
export type DriveOriginal = { bytes: Uint8Array; mime: string; name: string }

export type ParseDriveOptions = {
  /**
   * Called once with the file's bytes right after they are fetched, BEFORE
   * the parse (so a file above a parser cap is still kept). Errors are
   * swallowed — storing the original must never change the parse result.
   */
  onOriginal?: (original: DriveOriginal) => Promise<void>
}

export type ParsedDriveFile = {
  blocks: DriveBlock[]
  fileName: string
  mimeType: string
  fileId: string
}

// ── Main entry point ─────────────────────────────────────────────────

/**
 * Parse a single Google Drive file into one or more markdown blocks
 * matching refs/parsing-sources-template.md. Dispatches by mime:
 *
 *   - Google Docs → native markdown export (no content-conversion LLM pass)
 *   - Google Slides → pptx export, delegated to the office parser
 *   - Google Sheets → CSV export, preview with first N rows as a markdown table
 *   - Uploaded PDF/image/audio/video/docx/pptx → download bytes, delegate
 *     to the matching existing parser
 *   - Folders / Forms / Shortcuts / Drawings → skipped with reason
 *
 * Drive files are standalone sources (no parent message), so
 * `parent_source_id` is always null and `thread_id` is always null.
 */
export async function parseDriveFile(
  fileId: string,
  creds: GdriveCredentials,
  ai: ParserAiContext,
  opts: ParseDriveOptions = {},
): Promise<ParsedDriveFile> {
  const drive = getDriveClient(creds)

  const { data: meta } = await drive.files.get({
    fileId,
    fields:
      "id,name,mimeType,size,owners(displayName,emailAddress),createdTime,modifiedTime,webViewLink",
    supportsAllDrives: true,
  })

  const fileName = meta.name ?? "untitled"
  const mimeType = meta.mimeType ?? "application/octet-stream"

  // Structured source context used by every branch.
  const sourceCreatedAt = meta.createdTime ?? null
  // For Drive files we treat `received` as "when we first loaded the file
  // into the parser pipeline" — i.e. now. modifiedTime is a separate
  // concept (content edit) that doesn't map to the template's field.
  const nowIso = new Date().toISOString()
  const sourceReceivedAt = nowIso
  const webViewUrls = meta.webViewLink ? [meta.webViewLink] : []
  const ownerNames = uniqueStrings(
    (meta.owners ?? []).map(
      (o) => o.displayName?.trim() || o.emailAddress || "",
    ),
  )
  const sourceId = `drive:${fileId}`
  const ctx: DriveCtx = {
    sourceId,
    fileId,
    fileName,
    sourceSystem: "Google Drive",
    sourceCreatedAt,
    sourceReceivedAt,
    ownerNames,
    webViewUrls,
    nowIso,
    ai,
    onOriginal: opts.onOriginal,
  }

  // Dispatch.
  if (mimeType === GOOGLE_DOCS_MIME) {
    const block = await parseGoogleDoc(drive, ctx)
    return { blocks: [block], fileName, mimeType, fileId }
  }
  if (mimeType === GOOGLE_SHEETS_MIME) {
    const block = await parseGoogleSheet(drive, ctx)
    return { blocks: [block], fileName, mimeType, fileId }
  }
  if (mimeType === GOOGLE_SLIDES_MIME) {
    const block = await parseGoogleSlides(drive, ctx)
    return { blocks: [block], fileName, mimeType, fileId }
  }
  if (
    mimeType === GOOGLE_FOLDER_MIME ||
    mimeType === GOOGLE_FORM_MIME ||
    mimeType === GOOGLE_SHORTCUT_MIME ||
    mimeType === GOOGLE_DRAWING_MIME
  ) {
    throw new UnsupportedDriveTypeError(mimeType)
  }

  // Non-Google files: download bytes and route through the matching parser.
  const blocks = await parseNonGoogleFile(drive, ctx, mimeType)
  return { blocks, fileName, mimeType, fileId }
}

type DriveCtx = {
  sourceId: string
  fileId: string
  fileName: string
  sourceSystem: string
  sourceCreatedAt: string | null
  sourceReceivedAt: string
  ownerNames: string[]
  webViewUrls: string[]
  nowIso: string
  // Org / user the model calls are for.
  ai: ParserAiContext
  onOriginal?: ParseDriveOptions["onOriginal"]
}

async function emitOriginal(ctx: DriveCtx, original: DriveOriginal): Promise<void> {
  if (!ctx.onOriginal) return
  try {
    await ctx.onOriginal(original)
  } catch (err) {
    console.error(`[drive] storing the original of ${ctx.fileId} failed:`, err)
  }
}

// ── Google Docs ──────────────────────────────────────────────────────

async function parseGoogleDoc(
  drive: ReturnType<typeof getDriveClient>,
  ctx: DriveCtx,
): Promise<DriveBlock> {
  const res = await drive.files.export(
    { fileId: ctx.fileId, mimeType: "text/markdown" },
    { responseType: "text" },
  )
  // Google's export returns the markdown as a string in `response.data`.
  const contentMarkdown =
    typeof res.data === "string" ? res.data : String(res.data ?? "")
  await emitOriginal(ctx, {
    bytes: new TextEncoder().encode(contentMarkdown),
    mime: "text/markdown; charset=utf-8",
    name: `${ctx.fileName}.md`,
  })

  const { analysis, parserModel } = await runMetadataExtraction(ctx.ai, {
    context: `Filename: ${ctx.fileName}\nSource: Google Doc (exported as Markdown by Google's API)`,
    content: contentMarkdown,
    systemHint:
      "Extract structured metadata from the provided Google Doc (already in clean Markdown form).",
  })

  const frontmatter = buildStandardFrontmatter(ctx, {
    language: analysis.language,
    senders: ctx.ownerNames,
    recipients: [],
    mentions: uniqueStrings(analysis.mentions),
    companies: uniqueStrings(analysis.companies),
    products: uniqueStrings(analysis.products),
    urls: uniqueStrings([
      ...ctx.webViewUrls,
      ...extractUrls(contentMarkdown),
    ]),
  })

  return {
    kind: "docs",
    sourceId: ctx.sourceId,
    markdown: assembleMarkdown(
      frontmatter,
      analysis.summary,
      contentMarkdown.trim(),
    ),
    analysis: analysisFromMetadataOnly(analysis),
    parserModel,
  }
}

// ── Google Sheets ────────────────────────────────────────────────────

async function parseGoogleSheet(
  drive: ReturnType<typeof getDriveClient>,
  ctx: DriveCtx,
): Promise<DriveBlock> {
  const res = await drive.files.export(
    { fileId: ctx.fileId, mimeType: "text/csv" },
    { responseType: "text" },
  )
  const csv = typeof res.data === "string" ? res.data : String(res.data ?? "")
  await emitOriginal(ctx, {
    bytes: new TextEncoder().encode(csv),
    mime: "text/csv; charset=utf-8",
    name: `${ctx.fileName}.csv`,
  })

  const { headers, rows, totalDataRows } = parseCsvPreview(
    csv,
    SHEETS_PREVIEW_ROWS,
  )

  const preview = renderSheetPreview({ headers, rows, totalDataRows })

  const { analysis, parserModel } = await runMetadataExtraction(ctx.ai, {
    context: `Filename: ${ctx.fileName}\nSource: Google Sheet (first ${SHEETS_PREVIEW_ROWS} rows of ${totalDataRows} exported as CSV preview)`,
    content: preview,
    systemHint:
      "Extract structured metadata from the provided Google Sheet preview (column names + sample rows). The summary should describe what the sheet appears to track, not restate the raw data.",
  })

  const frontmatter = buildStandardFrontmatter(ctx, {
    language: analysis.language,
    senders: ctx.ownerNames,
    recipients: [],
    mentions: uniqueStrings(analysis.mentions),
    companies: uniqueStrings(analysis.companies),
    products: uniqueStrings(analysis.products),
    urls: uniqueStrings([...ctx.webViewUrls, ...extractUrls(preview)]),
  })

  return {
    kind: "sheets",
    sourceId: ctx.sourceId,
    markdown: assembleMarkdown(frontmatter, analysis.summary, preview.trim()),
    analysis: analysisFromMetadataOnly(analysis),
    parserModel,
  }
}

// ── Google Slides ────────────────────────────────────────────────────

async function parseGoogleSlides(
  drive: ReturnType<typeof getDriveClient>,
  ctx: DriveCtx,
): Promise<DriveBlock> {
  // Export as pptx so we can reuse the office parser (which produces
  // slide-by-slide markdown with `### Slide N` headings).
  const res = await drive.files.export(
    {
      fileId: ctx.fileId,
      mimeType:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    },
    { responseType: "arraybuffer" },
  )
  const bytes = new Uint8Array(res.data as unknown as ArrayBuffer)
  await emitOriginal(ctx, { bytes, mime: PPTX_MIME, name: `${ctx.fileName}.pptx` })

  const result = await parseOfficeBytes({
    bytes,
    fileName: `${ctx.fileName}.pptx`,
    mediaType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    sourceId: ctx.sourceId,
    parentSourceId: null,
    sourceSystem: ctx.sourceSystem,
    threadId: null,
    sourceCreatedAt: ctx.sourceCreatedAt,
    sourceReceivedAt: ctx.sourceReceivedAt,
  }, ctx.ai)

  return {
    kind: "slides",
    sourceId: ctx.sourceId,
    markdown: result.markdown,
    analysis: result.analysis,
    parserModel: result.parserModel,
  }
}

// ── Non-Google files ─────────────────────────────────────────────────

async function parseNonGoogleFile(
  drive: ReturnType<typeof getDriveClient>,
  ctx: DriveCtx,
  mimeType: string,
): Promise<DriveBlock[]> {
  const kind = detectNonGoogleKind(mimeType, ctx.fileName)
  if (!kind) throw new UnsupportedDriveTypeError(mimeType)

  const res = await drive.files.get(
    { fileId: ctx.fileId, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" },
  )
  const bytes = new Uint8Array(res.data as unknown as ArrayBuffer)
  await emitOriginal(ctx, { bytes, mime: mimeType, name: ctx.fileName })

  const commonInput = {
    sourceId: ctx.sourceId,
    parentSourceId: null,
    sourceSystem: ctx.sourceSystem,
    threadId: null,
    sourceCreatedAt: ctx.sourceCreatedAt,
    sourceReceivedAt: ctx.sourceReceivedAt,
  }

  if (kind === "pdf") {
    const result = await parsePdfBytes({
      ...commonInput,
      bytes,
      fileName: ctx.fileName,
    }, ctx.ai)
    return [
      {
        kind: "pdf",
        sourceId: ctx.sourceId,
        markdown: result.markdown,
        analysis: result.analysis,
        parserModel: result.parserModel,
      },
    ]
  }
  if (kind === "audio") {
    const result = await parseAudioBytes({
      ...commonInput,
      bytes,
      fileName: ctx.fileName,
      mediaType:
        mimeType && mimeType !== "application/octet-stream"
          ? mimeType
          : "audio/mpeg",
    }, ctx.ai)
    return [
      {
        kind: "audio",
        sourceId: ctx.sourceId,
        markdown: result.markdown,
        analysis: result.analysis,
        parserModel: result.parserModel,
      },
    ]
  }
  if (kind === "video") {
    const audioSourceId = `${ctx.sourceId}:audio`
    const result = await parseVideoBytes({
      bytes,
      fileName: ctx.fileName,
      mediaType:
        mimeType && mimeType !== "application/octet-stream"
          ? mimeType
          : "video/mp4",
      sourceSystem: ctx.sourceSystem,
      threadId: null,
      sourceCreatedAt: ctx.sourceCreatedAt,
      sourceReceivedAt: ctx.sourceReceivedAt,
      videoSourceId: ctx.sourceId,
      videoParentSourceId: null,
      audioSourceId,
      audioParentSourceId: ctx.sourceId,
    }, ctx.ai)
    return [
      {
        kind: "video",
        sourceId: ctx.sourceId,
        markdown: result.videoMarkdown,
        analysis: result.videoAnalysis,
        parserModel: result.parserModel,
      },
      {
        kind: "video_audio",
        sourceId: audioSourceId,
        markdown: result.audioMarkdown,
        analysis: result.audioAnalysis,
        parserModel: result.parserModel,
      },
    ]
  }
  if (kind === "office") {
    const format = detectOfficeFormat(mimeType, ctx.fileName)
    if (!format) throw new UnsupportedDriveTypeError(mimeType)
    const result = await parseOfficeBytes({
      ...commonInput,
      bytes,
      fileName: ctx.fileName,
      mediaType: mimeType,
    }, ctx.ai)
    return [
      {
        kind: format,
        sourceId: ctx.sourceId,
        markdown: result.markdown,
        analysis: result.analysis,
        parserModel: result.parserModel,
      },
    ]
  }

  // image
  const result = await parseImageBytes({
    ...commonInput,
    bytes,
    fileName: ctx.fileName,
    mediaType:
      mimeType && mimeType !== "application/octet-stream"
        ? mimeType
        : inferImageMediaType(ctx.fileName),
  }, ctx.ai)
  return [
    {
      kind: "image",
      sourceId: ctx.sourceId,
      markdown: result.markdown,
      analysis: result.analysis,
      parserModel: result.parserModel,
    },
  ]
}

const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation"

/**
 * Fetch the original bytes of one Drive file WITHOUT parsing it (documents
 * layer: lazy re-fetch + backfill, docs/specs/attachments). Same exports as
 * the parser (Docs → Markdown, Sheets → CSV, Slides → .pptx); any other file
 * is downloaded as is. Returns `null` for non-files (folders, forms,
 * shortcuts, drawings) and `{ tooLarge }` when Drive reports a size above
 * `maxBytes` (nothing downloaded). Provider errors are thrown.
 */
export async function fetchDriveOriginal(
  fileId: string,
  creds: GdriveCredentials,
  maxBytes: number,
): Promise<DriveOriginal | { tooLarge: true; size: number; mime: string } | null> {
  const drive = getDriveClient(creds)
  const { data: meta } = await drive.files.get({
    fileId,
    fields: "id,name,mimeType,size",
    supportsAllDrives: true,
  })
  const name = meta.name ?? "untitled"
  const mime = meta.mimeType ?? "application/octet-stream"
  const exportAs = async (exportMime: string, storedMime: string, ext: string): Promise<DriveOriginal> => {
    const res = await drive.files.export({ fileId, mimeType: exportMime }, { responseType: "arraybuffer" })
    return { bytes: new Uint8Array(res.data as unknown as ArrayBuffer), mime: storedMime, name: `${name}.${ext}` }
  }
  if (mime === GOOGLE_DOCS_MIME) return exportAs("text/markdown", "text/markdown; charset=utf-8", "md")
  if (mime === GOOGLE_SHEETS_MIME) return exportAs("text/csv", "text/csv; charset=utf-8", "csv")
  if (mime === GOOGLE_SLIDES_MIME) return exportAs(PPTX_MIME, PPTX_MIME, "pptx")
  if (mime.startsWith("application/vnd.google-apps.")) return null
  const size = Number(meta.size ?? 0)
  if (size > maxBytes) return { tooLarge: true, size, mime }
  const res = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" },
  )
  return { bytes: new Uint8Array(res.data as unknown as ArrayBuffer), mime, name }
}

function detectNonGoogleKind(
  mimeType: string,
  fileName: string,
): "pdf" | "image" | "audio" | "video" | "office" | null {
  const ct = mimeType.toLowerCase()
  const fn = fileName.toLowerCase()
  if (ct === "application/pdf" || fn.endsWith(".pdf")) return "pdf"
  if (isSupportedVideoType(ct, fn)) return "video"
  if (isSupportedAudioType(ct, fn)) return "audio"
  if (isSupportedImageType(ct, fn)) return "image"
  if (isSupportedOfficeType(ct, fn)) return "office"
  return null
}

function inferImageMediaType(fileName: string): string {
  return fileName.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg"
}

// ── Shared helpers ───────────────────────────────────────────────────

function analysisFromMetadataOnly(
  a: z.infer<typeof metadataOnlySchema>,
): MetadataAnalysis {
  return {
    language: a.language || "en",
    summary: a.summary,
    mentions: uniqueStrings(a.mentions),
    companies: uniqueStrings(a.companies),
    products: uniqueStrings(a.products),
    relevance: DEFAULT_RELEVANCE,
    mentionedPeople: filterMentionedPeople(a.mentionedPeople ?? []),
  }
}

async function runMetadataExtraction(
  ai: ParserAiContext,
  args: {
    context: string
    content: string
    systemHint: string
  },
): Promise<{
  analysis: z.infer<typeof metadataOnlySchema>
  parserModel: string | null
}> {
  const MAX_CHARS = 120_000
  const clipped =
    args.content.length > MAX_CHARS
      ? `${args.content.slice(0, MAX_CHARS)}\n\n[...truncated, ${args.content.length - MAX_CHARS} additional characters omitted]`
      : args.content

  const result = await aiGenerateText({
    process: "parsing.document_metadata",
    ...parserCallContext(ai),
    output: Output.object({ schema: metadataOnlySchema }),
    instructions: withOwnOrgLine(
      `${args.systemHint} Never fabricate facts that are not present in the provided content.

${MENTIONED_PEOPLE_PROMPT}

For Drive documents specifically: the 'author/sender' is the file owner (provided in the context); don't include them in mentionedPeople. Only emit third parties referenced in the document body. When inferring organization from the author's affiliation, only do so if the document itself states the author's company unambiguously.`,
      ai,
    ),
    prompt: `${args.context}\n\n--- BEGIN CONTENT ---\n${clipped}\n--- END CONTENT ---`,
  })
  return { analysis: result.output, parserModel: servedModel(result) }
}

function buildStandardFrontmatter(
  ctx: DriveCtx,
  fields: {
    language: string
    senders: string[]
    recipients: string[]
    mentions: string[]
    companies: string[]
    products: string[]
    urls: string[]
  },
): string {
  const sf: SourceFrontmatter = {
    sourceId: ctx.sourceId,
    parentSourceId: null,
    threadId: null,
    sourceSystem: ctx.sourceSystem,
    sourceCreatedAt: ctx.sourceCreatedAt,
    sourceReceivedAt: ctx.sourceReceivedAt,
    processedAt: ctx.nowIso,
    language: fields.language || "en",
    senders: fields.senders,
    recipients: fields.recipients,
    mentions: fields.mentions,
    companies: fields.companies,
    products: fields.products,
    urls: fields.urls,
  }
  return buildFrontmatter(sf)
}

// ── CSV preview ──────────────────────────────────────────────────────

export function parseCsvPreview(
  csv: string,
  previewRows: number,
): { headers: string[]; rows: string[][]; totalDataRows: number } {
  const lines = splitCsvLines(csv)
  if (lines.length === 0) return { headers: [], rows: [], totalDataRows: 0 }
  const headerLine = lines[0]
  const dataLines = lines.slice(1)
  const headers = parseCsvLine(headerLine)
  const rows = dataLines.slice(0, previewRows).map(parseCsvLine)
  return { headers, rows, totalDataRows: dataLines.length }
}

function splitCsvLines(csv: string): string[] {
  // Normalise line endings and split while keeping quoted-field newlines
  // intact. Google's CSV export rarely puts newlines inside cells, but a
  // proper parser should still survive it.
  const normalised = csv.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  const lines: string[] = []
  let cur = ""
  let inQuotes = false
  for (let i = 0; i < normalised.length; i++) {
    const c = normalised[i]
    if (c === '"') inQuotes = !inQuotes
    if (c === "\n" && !inQuotes) {
      if (cur.length > 0) lines.push(cur)
      cur = ""
    } else {
      cur += c
    }
  }
  if (cur.length > 0) lines.push(cur)
  return lines
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = []
  let cur = ""
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (c === '"') {
        inQuotes = false
      } else {
        cur += c
      }
    } else {
      if (c === '"') inQuotes = true
      else if (c === ",") {
        cells.push(cur)
        cur = ""
      } else {
        cur += c
      }
    }
  }
  cells.push(cur)
  return cells
}

function renderSheetPreview(args: {
  headers: string[]
  rows: string[][]
  totalDataRows: number
}): string {
  const { headers, rows, totalDataRows } = args
  if (headers.length === 0) {
    return "_(empty sheet)_"
  }
  const out: string[] = []
  out.push(`| ${headers.map(mdEscape).join(" | ")} |`)
  out.push(`| ${headers.map(() => "---").join(" | ")} |`)
  for (const row of rows) {
    // Pad to header length so the table stays rectangular.
    const padded = [...row]
    while (padded.length < headers.length) padded.push("")
    out.push(`| ${padded.map(mdEscape).join(" | ")} |`)
  }
  out.push("")
  if (totalDataRows > rows.length) {
    out.push(
      `_Showing first ${rows.length} of ${totalDataRows} data rows._`,
    )
  } else {
    out.push(`_Total data rows: ${totalDataRows}._`)
  }
  return out.join("\n")
}

function mdEscape(cell: string): string {
  // Pipes break markdown tables; newlines inside cells do too. Escape the
  // first, replace the second with a visible separator.
  return cell.replace(/\|/g, "\\|").replace(/\n/g, " / ").trim()
}

// ── Errors ───────────────────────────────────────────────────────────

export class UnsupportedDriveTypeError extends Error {
  constructor(public mimeType: string) {
    super(`Unsupported Drive file type: ${mimeType}`)
    this.name = "UnsupportedDriveTypeError"
  }
}

// Re-export so the API route's classifier can catch all parser errors
// without a separate import list.
export {
  PdfTooLargeError,
  ImageTooLargeError,
  UnsupportedImageTypeError,
  AudioTooLargeError,
  UnsupportedAudioTypeError,
  VideoTooLargeError,
  UnsupportedVideoTypeError,
  OfficeTooLargeError,
  UnsupportedOfficeTypeError,
}
