/**
 * Enrollment-code payload for one-step QR-based device join.
 *
 * The issuing device packs its active storage-provider credentials together
 * with the vault password into an encrypted envelope. The joining device
 * decrypts with the same vault password, restores the provider, and calls
 * `connectWithPassword` — see `.cortex/product-specs/password-envelope.md`.
 *
 * v2 codes encrypt the inner payload with a key derived from the vault
 * password (PBKDF2 + AES-GCM). v1 plaintext codes are still accepted on
 * the joining side for backward compatibility.
 */

export type EnrollmentCodePayloadV1 = {
  v: 1
  provider:
    | { type: 'local' }
    | {
        type: 'github'
        pat: string
        repo: string
      }
  password: string
  /** Which labelled password entry this code unlocks (optional for legacy codes). */
  entry_id?: string
  /** ISO 8601 UTC timestamp; informational, not enforced. */
  issued_at: string
}

export type EnrollmentCodeEnvelopeV2 = {
  v: 2
  /** ISO 8601 UTC timestamp; visible without decrypting. */
  issued_at: string
  kdf: 'pbkdf2-sha256'
  iterations: number
  salt: string
  cipher: 'aes-gcm-256'
  iv: string
  ct: string
}

const ENROLLMENT_HASH_PREFIX = '#enroll='
const PBKDF2_ITERATIONS = 210_000

export function encodeEnrollmentPayload(
  payload: EnrollmentCodePayloadV1,
): string {
  const json = JSON.stringify(payload)
  return base64UrlEncode(new TextEncoder().encode(json))
}

export async function encryptEnrollmentPayload(
  payload: EnrollmentCodePayloadV1,
  password: string,
): Promise<string> {
  const trimmed = password.trim()
  if (!trimmed) {
    throw new Error('Vault password is required to encrypt the enrollment QR.')
  }

  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveEnrollmentKey(trimmed, salt)
  const plaintext = new TextEncoder().encode(JSON.stringify(payload))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext,
  )

  const envelope: EnrollmentCodeEnvelopeV2 = {
    v: 2,
    issued_at: payload.issued_at,
    kdf: 'pbkdf2-sha256',
    iterations: PBKDF2_ITERATIONS,
    salt: base64UrlEncode(salt),
    cipher: 'aes-gcm-256',
    iv: base64UrlEncode(iv),
    ct: base64UrlEncode(new Uint8Array(ciphertext)),
  }

  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(envelope)))
}

export function enrollmentCodeRequiresPassword(code: string): boolean {
  return peekEnrollmentEnvelope(code)?.v === 2
}

export function peekEnrollmentIssuedAt(code: string): string | null {
  const envelope = peekEnrollmentEnvelope(code)
  if (!envelope) {
    return null
  }
  if (envelope.v === 2) {
    return envelope.issued_at
  }
  return envelope.issued_at ?? null
}

/** App root used in QR links (`origin` + Vite `BASE_URL`, or `VITE_PUBLIC_APP_URL`). */
export function getEnrollmentLinkBase(): string {
  if (typeof window === 'undefined') {
    return ''
  }
  const configured = import.meta.env.VITE_PUBLIC_APP_URL?.trim()
  if (configured) {
    return configured.replace(/\/$/, '')
  }
  const basePath = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '')
  return `${window.location.origin}${basePath}`
}

/** Deep link scanned from a QR code — opens the browser and carries the raw code in the hash. */
export function buildEnrollmentLink(
  code: string,
  baseUrl = getEnrollmentLinkBase(),
): string {
  const base = baseUrl.replace(/\/$/, '')
  return `${base}/${ENROLLMENT_HASH_PREFIX}${encodeURIComponent(code)}`
}

/** Accept raw base64url codes or full enrollment links (hash or query param). */
export function normalizeEnrollmentCode(input: string): string {
  const trimmed = input.trim()
  if (trimmed.length === 0) {
    return trimmed
  }

  if (trimmed.includes('://')) {
    try {
      const url = new URL(trimmed)
      const fromQuery = url.searchParams.get('enroll')
      if (fromQuery) {
        return decodeURIComponent(fromQuery)
      }
      if (url.hash.startsWith(ENROLLMENT_HASH_PREFIX)) {
        return decodeURIComponent(url.hash.slice(ENROLLMENT_HASH_PREFIX.length))
      }
    } catch {
      // Fall through — treat as raw code.
    }
  }

  if (trimmed.startsWith(ENROLLMENT_HASH_PREFIX)) {
    return decodeURIComponent(trimmed.slice(ENROLLMENT_HASH_PREFIX.length))
  }

  const queryMatch = trimmed.match(/[?&]enroll=([^&#]+)/)
  if (queryMatch) {
    return decodeURIComponent(queryMatch[1]!)
  }

  return trimmed
}

/**
 * Read an enrollment code from the current page URL (hash or query), then
 * strip it from the address bar so secrets do not linger in history.
 */
export function consumeEnrollmentFromLocation(): string | null {
  if (typeof window === 'undefined') {
    return null
  }

  const url = new URL(window.location.href)
  let raw: string | null

  if (url.hash.startsWith(ENROLLMENT_HASH_PREFIX)) {
    raw = decodeURIComponent(url.hash.slice(ENROLLMENT_HASH_PREFIX.length))
    url.hash = ''
  } else {
    raw = url.searchParams.get('enroll')
    if (raw) {
      url.searchParams.delete('enroll')
    }
  }

  if (!raw) {
    return null
  }

  history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  return normalizeEnrollmentCode(raw)
}

/**
 * @deprecated Use `decryptEnrollmentPayload` — kept for legacy callers/tests.
 */
export function decodeEnrollmentPayload(code: string): EnrollmentCodePayloadV1 {
  const envelope = peekEnrollmentEnvelope(code)
  if (!envelope) {
    throw new Error('Enrollment code is empty.')
  }
  if (envelope.v === 2) {
    throw new Error(
      'This enrollment code is encrypted. Enter the vault password to decrypt it.',
    )
  }
  return validatePayload(envelope)
}

export async function decryptEnrollmentPayload(
  code: string,
  password: string,
): Promise<EnrollmentCodePayloadV1> {
  const envelope = peekEnrollmentEnvelope(code)
  if (!envelope) {
    throw new Error('Enrollment code is empty.')
  }

  if (envelope.v === 1) {
    return validatePayload(envelope)
  }

  const trimmed = password.trim()
  if (!trimmed) {
    throw new Error('Enter the vault password that encrypted this QR.')
  }

  try {
    const key = await deriveEnrollmentKey(
      trimmed,
      base64UrlDecode(envelope.salt),
      envelope.iterations,
    )
    const iv = base64UrlDecode(envelope.iv)
    const ciphertext = base64UrlDecode(envelope.ct)
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bufferSource(iv) },
      key,
      bufferSource(ciphertext),
    )
    const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as unknown
    return validatePayload(parsed)
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('Enrollment code')) {
      throw e
    }
    const err = new Error(
      'Vault password does not decrypt this enrollment code.',
    )
    if (e instanceof Error) {
      err.cause = e
    }
    throw err
  }
}

function peekEnrollmentEnvelope(
  code: string,
): EnrollmentCodePayloadV1 | EnrollmentCodeEnvelopeV2 | null {
  const cleaned = normalizeEnrollmentCode(code)
  if (cleaned.length === 0) {
    return null
  }
  const bytes = base64UrlDecode(cleaned)
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null
  }
  const version = (parsed as { v?: unknown }).v
  if (version === 2) {
    return validateEnvelope(parsed)
  }
  if (version === 1) {
    return validatePayload(parsed)
  }
  return null
}

function validateEnvelope(value: unknown): EnrollmentCodeEnvelopeV2 {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Unsupported enrollment code version.')
  }
  const obj = value as Record<string, unknown>
  if (obj.v !== 2) {
    throw new Error('Unsupported enrollment code version.')
  }
  if (obj.kdf !== 'pbkdf2-sha256' || obj.cipher !== 'aes-gcm-256') {
    throw new Error('Unsupported enrollment encryption parameters.')
  }
  if (typeof obj.iterations !== 'number' || !Number.isFinite(obj.iterations)) {
    throw new Error('Enrollment code is missing KDF parameters.')
  }
  for (const field of ['salt', 'iv', 'ct', 'issued_at'] as const) {
    if (typeof obj[field] !== 'string' || obj[field].length === 0) {
      throw new Error(`Enrollment code is missing ${field}.`)
    }
  }
  return value as EnrollmentCodeEnvelopeV2
}

function validatePayload(value: unknown): EnrollmentCodePayloadV1 {
  if (
    typeof value !== 'object' ||
    value === null ||
    (value as { v?: unknown }).v !== 1
  ) {
    throw new Error('Unsupported enrollment code version.')
  }
  const obj = value as Record<string, unknown>
  const provider = obj.provider as Record<string, unknown> | null | undefined
  if (!provider || typeof provider.type !== 'string') {
    throw new Error('Enrollment code is missing provider details.')
  }
  if (provider.type === 'github') {
    if (typeof provider.pat !== 'string' || typeof provider.repo !== 'string') {
      throw new Error('GitHub provider in enrollment code is malformed.')
    }
  } else if (provider.type !== 'local') {
    throw new Error(`Unsupported provider type: ${String(provider.type)}`)
  }
  if (typeof obj.password !== 'string' || obj.password.length === 0) {
    throw new Error('Enrollment code is missing a password.')
  }
  if (typeof obj.issued_at !== 'string' || obj.issued_at.length === 0) {
    throw new Error('Enrollment code is missing the issued_at timestamp.')
  }
  return value as EnrollmentCodePayloadV1
}

async function deriveEnrollmentKey(
  password: string,
  salt: Uint8Array,
  iterations = PBKDF2_ITERATIONS,
): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: bufferSource(salt),
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

function bufferSource(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlDecode(encoded: string): Uint8Array {
  const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4)
  const binary = atob(padded)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i)
  }
  return out
}
