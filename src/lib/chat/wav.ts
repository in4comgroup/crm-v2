// WAV encoding for the AI chat voice recorder. Pure and client-safe (no DOM):
// the browser records raw PCM (Float32), we downsample it and pack it as a
// mono 16-bit PCM WAV, which the server audio parser accepts (WebM is not).

/** Target sample rate of voice messages (speech needs no more). */
export const WAV_SAMPLE_RATE = 16_000

/**
 * Longest recording in seconds. The parser takes files up to 10 MB;
 * 16 kHz mono 16-bit = 32 kB/s, so 5 minutes ≈ 9.6 MB.
 */
export const VOICE_MAX_SECONDS = 300

/**
 * Lowers the sample rate by averaging each window of input samples.
 * Returns the input unchanged when the rates are equal.
 */
export function downsampleTo(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input
  if (!(toRate > 0) || toRate > fromRate) {
    throw new Error(`downsampleTo: toRate (${toRate}) must be > 0 and ≤ fromRate (${fromRate})`)
  }
  const ratio = fromRate / toRate
  const outLength = Math.floor(input.length / ratio)
  const out = new Float32Array(outLength)
  for (let i = 0; i < outLength; i++) {
    const start = Math.floor(i * ratio)
    const end = Math.min(input.length, Math.floor((i + 1) * ratio))
    let sum = 0
    for (let j = start; j < end; j++) sum += input[j]
    out[i] = end > start ? sum / (end - start) : input[start] ?? 0
  }
  return out
}

/** Mono 16-bit PCM little-endian WAV with a 44-byte RIFF header. */
export function encodeWav16(samples: Float32Array, sampleRate: number): Uint8Array<ArrayBuffer> {
  const bytesPerSample = 2
  const dataSize = samples.length * bytesPerSample
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }

  writeAscii(0, "RIFF")
  view.setUint32(4, 36 + dataSize, true)
  writeAscii(8, "WAVE")
  writeAscii(12, "fmt ")
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * bytesPerSample, true) // byte rate
  view.setUint16(32, bytesPerSample, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  writeAscii(36, "data")
  view.setUint32(40, dataSize, true)

  let offset = 44
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] || 0))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    offset += bytesPerSample
  }
  return new Uint8Array(buffer)
}

const pad2 = (n: number) => String(n).padStart(2, "0")

/** «Голосовое сообщение 16.11.2026 14-05.wav» in local time (no colons: file-name safe). */
export function voiceFileName(d: Date): string {
  const day = `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}`
  const time = `${pad2(d.getHours())}-${pad2(d.getMinutes())}`
  return `Голосовое сообщение ${day} ${time}.wav`
}
