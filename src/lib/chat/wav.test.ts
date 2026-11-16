import { describe, expect, it } from "vitest"
import { VOICE_MAX_SECONDS, WAV_SAMPLE_RATE, downsampleTo, encodeWav16, voiceFileName } from "./wav"

const ascii = (bytes: Uint8Array, start: number, len: number) =>
  String.fromCharCode(...bytes.slice(start, start + len))

describe("encodeWav16", () => {
  it("writes a correct 44-byte RIFF header", () => {
    const n = 10
    const bytes = encodeWav16(new Float32Array(n), 16_000)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    expect(ascii(bytes, 0, 4)).toBe("RIFF")
    expect(view.getUint32(4, true)).toBe(36 + 2 * n)
    expect(ascii(bytes, 8, 4)).toBe("WAVE")
    expect(ascii(bytes, 12, 4)).toBe("fmt ")
    expect(view.getUint32(16, true)).toBe(16)
    expect(view.getUint16(20, true)).toBe(1) // PCM
    expect(view.getUint16(22, true)).toBe(1) // mono
    expect(view.getUint32(24, true)).toBe(16_000)
    expect(view.getUint32(28, true)).toBe(32_000) // byte rate
    expect(view.getUint16(32, true)).toBe(2) // block align
    expect(view.getUint16(34, true)).toBe(16) // bits
    expect(ascii(bytes, 36, 4)).toBe("data")
    expect(view.getUint32(40, true)).toBe(2 * n)
  })

  it("has length 44 + 2·n", () => {
    expect(encodeWav16(new Float32Array(0), 16_000).length).toBe(44)
    expect(encodeWav16(new Float32Array(1234), 16_000).length).toBe(44 + 2 * 1234)
  })

  it("clamps samples to [-1, 1]", () => {
    const bytes = encodeWav16(Float32Array.from([2, -2, 1, -1, 0, 0.5]), 16_000)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const s = (i: number) => view.getInt16(44 + 2 * i, true)
    expect(s(0)).toBe(32767)
    expect(s(1)).toBe(-32768)
    expect(s(2)).toBe(32767)
    expect(s(3)).toBe(-32768)
    expect(s(4)).toBe(0)
    expect(s(5)).toBe(Math.trunc(0.5 * 0x7fff))
  })
})

describe("downsampleTo", () => {
  it("returns the input when the rates are equal", () => {
    const input = new Float32Array([0.1, 0.2])
    expect(downsampleTo(input, 16_000, 16_000)).toBe(input)
  })

  it("48 kHz → 16 kHz gives a third of the samples, averaged", () => {
    const input = new Float32Array(48_000).fill(0.25)
    const out = downsampleTo(input, 48_000, WAV_SAMPLE_RATE)
    expect(out.length).toBe(16_000)
    expect(out[0]).toBeCloseTo(0.25)
    expect(Array.from(downsampleTo(Float32Array.from([0, 0.3, 0.6, 1, 1, 1]), 48_000, 16_000))).toEqual([
      expect.closeTo(0.3),
      expect.closeTo(1),
    ])
  })

  it("44.1 kHz → 16 kHz keeps the duration", () => {
    expect(downsampleTo(new Float32Array(44_100), 44_100, 16_000).length).toBe(16_000)
  })

  it("refuses upsampling", () => {
    expect(() => downsampleTo(new Float32Array(10), 16_000, 48_000)).toThrow()
  })
})

describe("voiceFileName", () => {
  it("formats local date and time without colons", () => {
    expect(voiceFileName(new Date(2026, 10, 16, 14, 5))).toBe("Голосовое сообщение 16.11.2026 14-05.wav")
    expect(voiceFileName(new Date(2027, 0, 2, 9, 7))).toBe("Голосовое сообщение 02.01.2027 09-07.wav")
  })
})

describe("limits", () => {
  it("5 minutes at 16 kHz mono 16-bit stays under 10 MB", () => {
    expect(44 + VOICE_MAX_SECONDS * WAV_SAMPLE_RATE * 2).toBeLessThan(10 * 1024 * 1024)
  })
})
