import { describe, expect, it } from "vitest"
import {
  assignTelegramWindows,
  decideTelegramWindow,
  gchatThreadKey,
  imapThreadKey,
  normalizeMessageId,
  nylasThreadKey,
  parseMessageIdList,
  parseTelegramThreadKey,
  readHeaderField,
  telegramMessageIdOf,
  telegramThreadKey,
  threadKeyForStoredItem,
  whatsappThreadKey,
} from "./thread-key"

const HOUR = 60 * 60 * 1000
const t0 = new Date("2026-06-13T06:00:00Z")
const at = (ms: number) => new Date(t0.getTime() + ms)

describe("Message-ID normalisation", () => {
  it("trims, strips <> and lower-cases", () => {
    expect(normalizeMessageId("  <ABC.123@Mail.Example.COM> ")).toBe("abc.123@mail.example.com")
    expect(normalizeMessageId("x@y")).toBe("x@y")
    expect(normalizeMessageId("<>")).toBeNull()
    expect(normalizeMessageId("")).toBeNull()
    expect(normalizeMessageId(null)).toBeNull()
  })

  it("parses a References header value in order", () => {
    expect(parseMessageIdList("<A@x>\r\n <b@Y>  <c@z>")).toEqual(["a@x", "b@y", "c@z"])
    expect(parseMessageIdList(["<A@x>", "b@y"])).toEqual(["a@x", "b@y"])
    expect(parseMessageIdList("a@x b@y")).toEqual(["a@x", "b@y"])
    expect(parseMessageIdList(undefined)).toEqual([])
  })

  it("reads a folded header field case-insensitively", () => {
    const raw = "References: <a@x>\r\n\t<b@y>\r\nIn-Reply-To: <B@y>\r\n\r\n"
    expect(readHeaderField(raw, "references")).toBe("<a@x> <b@y>")
    expect(readHeaderField(raw, "IN-REPLY-TO")).toBe("<B@y>")
    expect(readHeaderField(raw, "subject")).toBeNull()
  })
})

describe("per-provider keys", () => {
  it("nylas", () => {
    expect(nylasThreadKey("1a19b7ad2a7cb7de")).toBe("nylas:1a19b7ad2a7cb7de")
    expect(nylasThreadKey(null)).toBeNull()
    expect(nylasThreadKey("  ")).toBeNull()
  })

  it("imap: References[0] → In-Reply-To → own Message-ID", () => {
    expect(
      imapThreadKey({ references: "<Root@x> <mid@x>", inReplyTo: "<mid@x>", messageId: "<me@x>" }),
    ).toBe("imap:root@x")
    expect(imapThreadKey({ references: [], inReplyTo: "<Parent@X>", messageId: "<me@x>" })).toBe(
      "imap:parent@x",
    )
    expect(imapThreadKey({ messageId: "<Me@X>" })).toBe("imap:me@x")
    expect(imapThreadKey({})).toBeNull()
  })

  it("gchat: space id + thread id from resource names or bare ids", () => {
    expect(gchatThreadKey("spaces/AAQA8JhMLes", "spaces/AAQA8JhMLes/threads/T1")).toBe(
      "gchat:AAQA8JhMLes/T1",
    )
    expect(gchatThreadKey("AAQA", "T1")).toBe("gchat:AAQA/T1")
    expect(gchatThreadKey("spaces/AAQA", null)).toBeNull()
  })

  it("whatsapp: archive chat name normalised, groupKey kept", () => {
    expect(whatsappThreadKey("WhatsApp Chat - Ромашка  ООО", "abc123")).toBe("wa:ромашка ооо:abc123")
    expect(whatsappThreadKey(null, "abc123")).toBe("wa:_:abc123")
    expect(whatsappThreadKey("x", null)).toBeNull()
  })

  it("telegram key round-trips", () => {
    expect(telegramThreadKey(-100123, 45)).toBe("tg:-100123:45")
    expect(parseTelegramThreadKey("tg:-100123:45")).toEqual({ chatId: "-100123", windowId: "45" })
    expect(parseTelegramThreadKey("nylas:x")).toBeNull()
  })

  it("telegram message id from metadata or external id", () => {
    expect(telegramMessageIdOf({ telegram: { messageId: 7 } }, "1:9")).toBe("7")
    expect(telegramMessageIdOf({}, "325741329:9")).toBe("9")
    expect(telegramMessageIdOf(null, "bad")).toBeNull()
  })
})

describe("telegram window decision", () => {
  it("first message starts a window with its own id", () => {
    expect(decideTelegramWindow(null, { at: t0, messageId: 5 })).toEqual({
      windowId: "5",
      windowSize: 1,
      isNew: true,
    })
  })

  it("joins within 1 h, splits after a > 1 h gap", () => {
    const prev = { at: t0, windowId: "5", windowSize: 3 }
    expect(decideTelegramWindow(prev, { at: at(HOUR), messageId: 9 })).toEqual({
      windowId: "5",
      windowSize: 4,
      isNew: false,
    })
    expect(decideTelegramWindow(prev, { at: at(HOUR + 1000), messageId: 9 }).windowId).toBe("9")
  })

  it("splits when the window already has 100 messages", () => {
    const prev = { at: t0, windowId: "5", windowSize: 100 }
    expect(decideTelegramWindow(prev, { at: at(1000), messageId: 200 }).windowId).toBe("200")
  })

  it("starts a new window when the previous message has no key", () => {
    const prev = { at: t0, windowId: null, windowSize: 0 }
    expect(decideTelegramWindow(prev, { at: at(1000), messageId: 6 }).isNew).toBe(true)
  })
})

describe("assignTelegramWindows (backfill)", () => {
  it("windows a chat's history by gap", () => {
    const keys = assignTelegramWindows("325741329", [
      { id: "a", at: at(0), messageId: 1, threadKey: null },
      { id: "b", at: at(18_000), messageId: 2, threadKey: null },
      { id: "c", at: at(HOUR * 2), messageId: 7, threadKey: null },
      { id: "d", at: at(HOUR * 2 + 60_000), messageId: 9, threadKey: null },
    ])
    expect(Object.fromEntries(keys)).toEqual({
      a: "tg:325741329:1",
      b: "tg:325741329:1",
      c: "tg:325741329:7",
      d: "tg:325741329:7",
    })
  })

  it("keeps existing keys and continues their window", () => {
    const keys = assignTelegramWindows("1", [
      { id: "a", at: at(0), messageId: 1, threadKey: null },
      { id: "b", at: at(60_000), messageId: 2, threadKey: "tg:1:2" },
      { id: "c", at: at(120_000), messageId: 3, threadKey: null },
    ])
    expect(Object.fromEntries(keys)).toEqual({ a: "tg:1:1", c: "tg:1:2" })
  })

  it("caps a window at 100 messages", () => {
    const items = Array.from({ length: 205 }, (_, i) => ({
      id: String(i),
      at: at(i * 1000),
      messageId: i + 1,
      threadKey: null,
    }))
    const keys = assignTelegramWindows("1", items)
    expect(keys.get("99")).toBe("tg:1:1")
    expect(keys.get("100")).toBe("tg:1:101")
    expect(keys.get("200")).toBe("tg:1:201")
  })
})

describe("threadKeyForStoredItem", () => {
  it("imap without References uses thread_external_id (In-Reply-To), then Message-ID", () => {
    expect(
      threadKeyForStoredItem({
        provider: "imap",
        externalId: "1:2",
        threadExternalId: "<Parent@x>",
        metadata: { messageId: "<me@x>" },
      }),
    ).toBe("imap:parent@x")
    expect(
      threadKeyForStoredItem({
        provider: "imap",
        externalId: "1:2",
        threadExternalId: null,
        metadata: { messageId: "<Me@x>" },
      }),
    ).toBe("imap:me@x")
  })

  it("gchat takes the space from the message resource name", () => {
    expect(
      threadKeyForStoredItem({
        provider: "gchat",
        externalId: "spaces/S1/messages/M1",
        threadExternalId: "T1",
        metadata: {},
      }),
    ).toBe("gchat:S1/T1")
  })

  it("whatsapp tombstones and documents get no key", () => {
    expect(
      threadKeyForStoredItem({
        provider: "whatsapp",
        externalId: "whatsapp:group:x",
        threadExternalId: null,
        metadata: { analysisExcluded: true, groupKey: "x" },
      }),
    ).toBeNull()
    for (const provider of ["gdrive", "dropoff", "aichat", "telegram"]) {
      expect(
        threadKeyForStoredItem({ provider, externalId: "x", threadExternalId: "y", metadata: {} }),
      ).toBeNull()
    }
  })
})
