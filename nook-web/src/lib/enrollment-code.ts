/**
 * Enrollment-code payload for one-step QR-based device join.
 *
 * The issuing device packs storage-provider credentials with a vault password
 * entry id into an encrypted envelope. The joining device enters the vault
 * password, decrypts provider access, and calls `connectWithPassword`.
 *
 * The password is never embedded in the QR; only `entry_id` (and an optional
 * label hint) appear in the outer envelope. Provider credentials are encrypted
 * with a key derived from the vault password (PBKDF2 + AES-GCM).
 */

export type EnrollmentProvider =
  | { type: 'local' }
  | {
      type: 'github'
      pat: string
      repo: string
    }

export type EnrollmentIssueInput = {
  provider: EnrollmentProvider
  entry_id: string
  issued_at: string
}

export type DecryptedEnrollmentPayload = {
  provider: EnrollmentProvider
  entry_id: string
  issued_at: string
}

export type EnrollmentCodeEnvelope = {
  entry_id: string
  /** Human-readable hint for the join UI; not secret. */
  entry_label?: string
  issued_at: string
  kdf: 'pbkdf2-sha256'
  iterations: number
  salt: string
  cipher: 'aes-gcm-256'
  iv: string
  ct: string
}

type EnrollmentProviderPayload = {
  provider: EnrollmentProvider
}

const ENROLLMENT_HASH_PREFIX = '#enroll='
const PBKDF2_ITERATIONS = 210_000

export async function encryptEnrollmentPayload(
  payload: EnrollmentIssueInput,
  password: string,
  entryLabel = '',
): Promise<string> {
  const trimmed = password.trim()
  if (!trimmed) {
    throw new Error('Vault password is required to encrypt the enrollment QR.')
  }
  const entryId = payload.entry_id.trim()
  if (!entryId) {
    throw new Error('Enrollment payload requires a vault password entry id.')
  }

  const inner: EnrollmentProviderPayload = { provider: payload.provider }
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveEnrollmentKey(trimmed, salt)
  const plaintext = new TextEncoder().encode(JSON.stringify(inner))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext,
  )

  const envelope: EnrollmentCodeEnvelope = {
    entry_id: entryId,
    ...(entryLabel.trim() ? { entry_label: entryLabel.trim() } : {}),
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

export function peekEnrollmentIssuedAt(code: string): string | null {
  const envelope = peekEnrollmentEnvelope(code)
  return envelope?.issued_at ?? null
}

export function peekEnrollmentEntryId(code: string): string | null {
  return peekEnrollmentEnvelope(code)?.entry_id ?? null
}

export function peekEnrollmentEntryLabel(code: string): string | null {
  return peekEnrollmentEnvelope(code)?.entry_label ?? null
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

export async function decryptEnrollmentPayload(
  code: string,
  password: string,
): Promise<DecryptedEnrollmentPayload> {
  const envelope = peekEnrollmentEnvelope(code)
  if (!envelope) {
    throw new Error('Invalid enrollment code.')
  }

  const trimmed = password.trim()
  if (!trimmed) {
    throw new Error('Enter the vault password for this onboarding QR.')
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
    const providerPayload = validateProviderPayload(parsed)

    return {
      provider: providerPayload.provider,
      entry_id: envelope.entry_id,
      issued_at: envelope.issued_at,
    }
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

function peekEnrollmentEnvelope(code: string): EnrollmentCodeEnvelope | null {
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
  try {
    return validateEnvelope(parsed)
  } catch {
    return null
  }
}

function validateEnvelope(value: unknown): EnrollmentCodeEnvelope {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Invalid enrollment code.')
  }
  const obj = value as Record<string, unknown>
  if (obj.kdf !== 'pbkdf2-sha256' || obj.cipher !== 'aes-gcm-256') {
    throw new Error('Unsupported enrollment encryption parameters.')
  }
  if (typeof obj.iterations !== 'number' || !Number.isFinite(obj.iterations)) {
    throw new Error('Enrollment code is missing KDF parameters.')
  }
  if (typeof obj.entry_id !== 'string' || obj.entry_id.length === 0) {
    throw new Error('Enrollment code is missing entry_id.')
  }
  if (obj.entry_label !== undefined && typeof obj.entry_label !== 'string') {
    throw new Error('Enrollment code has an invalid entry_label.')
  }
  for (const field of ['salt', 'iv', 'ct', 'issued_at'] as const) {
    if (typeof obj[field] !== 'string' || obj[field].length === 0) {
      throw new Error(`Enrollment code is missing ${field}.`)
    }
  }
  return value as EnrollmentCodeEnvelope
}

function validateProviderPayload(value: unknown): EnrollmentProviderPayload {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Enrollment code is missing provider details.')
  }
  const provider = (value as { provider?: unknown }).provider as
    | Record<string, unknown>
    | null
    | undefined
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
  return value as EnrollmentProviderPayload
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
