import { createHmac } from 'node:crypto'

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function decodeBase32(secret: string): Buffer {
  const normalized = secret
    .replace(/=+$/u, '')
    .toUpperCase()
    .replace(/\s+/gu, '')
  let bits = ''
  for (const char of normalized) {
    const value = BASE32_ALPHABET.indexOf(char)
    if (value < 0) {
      throw new Error(`Invalid base32 secret character: ${char}`)
    }
    bits += value.toString(2).padStart(5, '0')
  }
  const bytes: number[] = []
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2))
  }
  return Buffer.from(bytes)
}

export function generateTotpCode(
  base32Secret: string,
  nowMs = Date.now(),
  stepSeconds = 30,
  digits = 6,
): string {
  const key = decodeBase32(base32Secret)
  const counter = Math.floor(nowMs / 1000 / stepSeconds)
  const counterBuffer = Buffer.alloc(8)
  counterBuffer.writeUInt32BE(Math.floor(counter / 0x1_0000_0000), 0)
  counterBuffer.writeUInt32BE(counter & 0xffff_ffff, 4)
  const digest = createHmac('sha1', key).update(counterBuffer).digest()
  const offset = digest[digest.length - 1]! & 0x0f
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff)
  return (binary % 10 ** digits).toString().padStart(digits, '0')
}

export function verifyTotpCode(
  base32Secret: string,
  code: string,
  nowMs = Date.now(),
  window = 1,
): boolean {
  const trimmed = code.trim()
  if (!/^\d{6}$/u.test(trimmed)) return false
  for (let offset = -window; offset <= window; offset += 1) {
    const candidate = generateTotpCode(base32Secret, nowMs + offset * 30_000)
    if (candidate === trimmed) return true
  }
  return false
}
