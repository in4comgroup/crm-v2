import { NextRequest, NextResponse } from "next/server"
import { randomUUID } from "node:crypto"
import { getServerSession } from "@/lib/get-session"
import {
  findActiveOrgSourceByProvider,
  insertSourceItem,
} from "@/server/source-uploads"
import {
  parseDropoffFile,
  UnsupportedDropoffTypeError,
  PdfTooLargeError,
  ImageTooLargeError,
  UnsupportedImageTypeError,
  AudioTooLargeError,
  UnsupportedAudioTypeError,
  VideoTooLargeError,
  UnsupportedVideoTypeError,
  OfficeTooLargeError,
  UnsupportedOfficeTypeError,
} from "@/server/parsers/dropoff"
import { getOwnOrgContext } from "@/server/identity/own-org"
import { buildOwnOrgPromptLine, parserAiContext } from "@/server/parsers/_shared"
import {
  autoLinkDocumentsOfItems,
  storeRootOriginal,
} from "@/server/documents-ingest"

// Video transcription dominates wall-clock — match the per-item Parse
// route's ceiling so the longest path fits.
export const maxDuration = 300

type UploadResult =
  | { fileName: string; ok: true; itemId: string; childCount: number }
  | { fileName: string; ok: false; error: string; reason: "unsupported" | "too_large" | "failed" }

// Multipart upload of one or more drop-off files. Each file is parsed
// inline (PDF / image / audio / video / office) and inserted as a
// `source_item` row directly into the Processed bucket — no Pending row
// is ever created, since for drop-off "uploaded" and "ready to parse"
// happen in the same request. Since documents D1 the original bytes are
// stored too (`source_item.file_*`, ≤ 50 MB) and the automatic document
// links run (docs/specs/attachments §4); a stored row can be re-parsed by
// the normal pipeline (`parseSourceItem` → drop-off branch).
export async function POST(request: NextRequest) {
  const session = await getServerSession()
  const activeOrgId = session?.session.activeOrganizationId
  if (!session || !activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 })
  }

  const description = String(formData.get("description") ?? "").trim()
  const files = formData
    .getAll("files")
    .filter((v): v is File => v instanceof File)
  if (files.length === 0) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 })
  }

  // Drop-off source for the caller's active org. After per-org sources
  // landed, the previous `is_system = true` lookup no longer matches —
  // every drop-off source is owned by exactly one org now.
  const dropoffSource = await findActiveOrgSourceByProvider(
    "dropoff",
    activeOrgId,
  )
  if (!dropoffSource) {
    return NextResponse.json(
      { error: "No drop-off source configured for this organization" },
      { status: 404 },
    )
  }

  const userName = session.user?.name ?? "Unknown user"
  const results: UploadResult[] = []

  for (const file of files) {
    const fileName = file.name || "untitled"
    const dropoffId = randomUUID()
    try {
      const buffer = new Uint8Array(await file.arrayBuffer())
      const parsed = await parseDropoffFile({
        bytes: buffer,
        fileName,
        mediaType: file.type || "application/octet-stream",
        dropoffId,
        description,
        userName,
        uploadedAt: new Date().toISOString(),
      }, parserAiContext(activeOrgId, session.user.id, buildOwnOrgPromptLine(await getOwnOrgContext(activeOrgId).catch(() => null))))

      const now = new Date()
      const rootId = randomUUID()
      const firstBlock = parsed.blocks[0]
      await insertSourceItem({
        id: rootId,
        sourceId: dropoffSource.id,
        organizationId: dropoffSource.organizationId,
        externalId: `dropoff:${dropoffId}`,
        externalType: "dropoff_file",
        metadataJson: {
          description,
          userName,
          dropoffId,
          ...firstBlock.analysis,
        },
        filename: fileName,
        mimeType: parsed.mediaType,
        sizeBytes: parsed.byteSize,
        sourceCreatedAt: now,
        fetchedAt: now,
        parseStatus: "complete",
        parsedAt: now,
        // The model that actually parsed this file (parse runs before insert).
        parserModel: firstBlock.parserModel,
        parsedMarkdown: firstBlock.markdown,
      })

      // Extra blocks become children — currently only video → audio.
      let childCount = 0
      for (let i = 1; i < parsed.blocks.length; i++) {
        const extra = parsed.blocks[i]
        await insertSourceItem({
          id: randomUUID(),
          sourceId: dropoffSource.id,
          organizationId: dropoffSource.organizationId,
          externalId: extra.sourceId,
          externalType:
            extra.kind === "video_audio" ? "derived_audio" : "attachment",
          metadataJson: { dropoffId, ...extra.analysis },
          parentSourceItemId: rootId,
          filename: fileName,
          mimeType: extra.kind === "video_audio" ? "audio/mp4" : parsed.mediaType,
          sourceCreatedAt: now,
          fetchedAt: now,
          parseStatus: "complete",
          parsedAt: now,
          parserModel: extra.parserModel,
          parsedMarkdown: extra.markdown,
        })
        childCount++
      }

      // Documents: keep the original + automatic links (best effort — both
      // never throw; a failed store leaves the parsed row as it is).
      if (dropoffSource.organizationId) {
        await storeRootOriginal(dropoffSource.organizationId, rootId, buffer, {
          name: fileName,
          mime: parsed.mediaType,
        })
        await autoLinkDocumentsOfItems(dropoffSource.organizationId, [rootId])
      }

      results.push({ fileName, ok: true, itemId: rootId, childCount })
    } catch (err) {
      results.push(classifyUploadError(fileName, err))
    }
  }

  const okCount = results.filter((r) => r.ok).length
  return NextResponse.json({
    results,
    okCount,
    failedCount: results.length - okCount,
  })
}

function classifyUploadError(fileName: string, err: unknown): UploadResult {
  if (err instanceof UnsupportedDropoffTypeError) {
    return {
      fileName,
      ok: false,
      reason: "unsupported",
      error: err.message,
    }
  }
  if (
    err instanceof UnsupportedImageTypeError ||
    err instanceof UnsupportedAudioTypeError ||
    err instanceof UnsupportedVideoTypeError ||
    err instanceof UnsupportedOfficeTypeError
  ) {
    return {
      fileName,
      ok: false,
      reason: "unsupported",
      error: err.message,
    }
  }
  if (
    err instanceof PdfTooLargeError ||
    err instanceof ImageTooLargeError ||
    err instanceof AudioTooLargeError ||
    err instanceof VideoTooLargeError ||
    err instanceof OfficeTooLargeError
  ) {
    return {
      fileName,
      ok: false,
      reason: "too_large",
      error: err.message,
    }
  }
  console.error("[dropoff/upload] Parse failed", { fileName, err })
  return {
    fileName,
    ok: false,
    reason: "failed",
    error: err instanceof Error ? err.message : String(err),
  }
}
