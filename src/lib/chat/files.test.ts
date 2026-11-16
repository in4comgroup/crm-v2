import { describe, expect, it } from "vitest"
import { chatFileIdFromUrl, chatFileKind, chatFileProblem, chatFileUrl, chatUploadParts, CHAT_UPLOAD_CHUNK_BYTES } from "./files"

describe("chat files", () => {
  it("kinds by type or extension", () => {
    expect(chatFileKind("image/jpeg", "card.jpg")).toBe("image")
    expect(chatFileKind("", "notes.PDF")).toBe("pdf")
    expect(chatFileKind("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "x.docx")).toBe("office")
    expect(chatFileKind("audio/wav", "voice.wav")).toBe("audio")
    expect(chatFileKind("audio/ogg", "v.ogg")).toBe("audio")
    expect(chatFileKind("video/mp4", "clip.mp4")).toBe("video")
    expect(chatFileKind("text/csv", "list.csv")).toBe("text")
    expect(chatFileKind("image/webp", "x.webp")).toBeNull() // converted to JPEG in the browser first
    expect(chatFileKind("application/zip", "a.zip")).toBeNull()
  })

  it("size limits = the parser limits; Russian problems", () => {
    expect(chatFileProblem("image/png", "a.png", 1000)).toBeNull()
    expect(chatFileProblem("image/png", "a.png", 6 * 1024 * 1024)).toMatch(/больше 5 МБ/)
    expect(chatFileProblem("audio/wav", "v.wav", 11 * 1024 * 1024)).toMatch(/больше 10 МБ/)
    expect(chatFileProblem("application/zip", "a.zip", 10)).toMatch(/не поддерживается/)
    expect(chatFileProblem("text/plain", "a.txt", 0)).toMatch(/пустой/)
  })

  it("file URL round trip; foreign URLs and data URLs are not chat files", () => {
    expect(chatFileIdFromUrl(chatFileUrl("a35c369d-fe21-474e-b64a-c38d9b10092d"))).toBe("a35c369d-fe21-474e-b64a-c38d9b10092d")
    expect(chatFileIdFromUrl("data:image/png;base64,AAA")).toBeNull()
    expect(chatFileIdFromUrl("https://evil.example/api/documents/abcdefgh/file")).toBeNull()
    expect(chatFileIdFromUrl("/api/documents/../x/file")).toBeNull()
  })

  it("parts of ≤ 4 MB", () => {
    expect(chatUploadParts(1)).toBe(1)
    expect(chatUploadParts(CHAT_UPLOAD_CHUNK_BYTES)).toBe(1)
    expect(chatUploadParts(CHAT_UPLOAD_CHUNK_BYTES + 1)).toBe(2)
    expect(chatUploadParts(10 * 1024 * 1024)).toBe(3)
  })
})
