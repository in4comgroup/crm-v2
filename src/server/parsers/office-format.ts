import "server-only"
import { PARSER_CONFIG } from "@/lib/parser-config"

// Office formats the parser reads (no AI here — unit-testable).

export type OfficeFormat = "docx" | "pptx" | "xlsx" | "csv"

const OFFICE_MIME: Record<OfficeFormat, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
}

/** The media type of a format (the fallback when the file came as octet-stream). */
export function officeMediaType(format: OfficeFormat): string {
  return OFFICE_MIME[format]
}

export function isSupportedOfficeType(
  mediaType: string,
  fileName: string,
): boolean {
  if (
    PARSER_CONFIG.office.supportedMediaTypes.includes(mediaType.toLowerCase())
  )
    return true
  const lower = fileName.toLowerCase()
  return PARSER_CONFIG.office.supportedExtensions.some((ext) =>
    lower.endsWith(ext),
  )
}

export function detectOfficeFormat(
  mediaType: string,
  fileName: string,
): OfficeFormat | null {
  const ct = mediaType.toLowerCase()
  const fn = fileName.toLowerCase()
  if (
    ct ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    fn.endsWith(".docx")
  ) {
    return "docx"
  }
  if (
    ct ===
      "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    fn.endsWith(".pptx")
  ) {
    return "pptx"
  }
  if (ct.startsWith(OFFICE_MIME.xlsx) || fn.endsWith(".xlsx")) return "xlsx"
  if (ct.startsWith("text/csv") || fn.endsWith(".csv")) return "csv"
  return null
}
