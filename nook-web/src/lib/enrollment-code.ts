/**
 * Enrollment-code payload for one-step QR-based device join.
 *
 * The issuing device packs its active storage-provider credentials together
 * with the user-typed vault password into a compact base64url-encoded JSON
 * blob. The joining device decodes this, restores the provider, and calls
 * `connectWithPassword` — see `.cortex/product-specs/password-envelope.md`.
 *
 * The payload carries an `issued_at` timestamp purely as audit metadata
 * (so the UI can show "issued X minutes ago" and the user can identify
 * stale codes by sight). It is **not** an expiration: the vault password
 * is the long-lived credential and rotating it is the only revocation
 * primitive.
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

const ENROLLMENT_HASH_PREFIX = '#enroll='

export function encodeEnrollmentPayload(
  payload: EnrollmentCodePayloadV1,
): string {
  const json = JSON.stringify(payload)
  return base64UrlEncode(new TextEncoder().encode(json))
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
  let raw: string | null = null

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

export function decodeEnrollmentPayload(code: string): EnrollmentCodePayloadV1 {
  const cleaned = normalizeEnrollmentCode(code)
  if (cleaned.length === 0) {
    throw new Error('Enrollment code is empty.')
  }
  const bytes = base64UrlDecode(cleaned)
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes))
  } catch (e) {
    throw new Error(
      `Enrollment code is not valid base64url JSON: ${e instanceof Error ? e.message : String(e)}`,
      { cause: e },
    )
  }
  return validatePayload(parsed)
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
