/**
 * Enrollment-code payload for one-step QR-based device join.
 *
 * The issuing device packs storage-provider credentials with a vault password
 * entry id into an encrypted envelope. The joining device enters the vault
 * password, decrypts provider access, and calls `connectWithPassword`.
 *
 * The password is never embedded in the QR; only `entry_id` (and an optional
 * label hint) appear in the outer envelope. Rust core owns the envelope schema,
 * validation, PBKDF2 key derivation, and AES-GCM encryption.
 */

import {
  NookEnrollmentIssueInput,
  NookEnrollmentProvider,
  StorageProviderType,
  default as initNookWasm,
  decryptEnrollmentPayload as decryptEnrollmentPayloadCore,
  encryptEnrollmentPayload as encryptEnrollmentPayloadCore,
  peekEnrollmentEntryId as peekEnrollmentEntryIdCore,
  peekEnrollmentEntryLabel as peekEnrollmentEntryLabelCore,
  peekEnrollmentIssuedAt as peekEnrollmentIssuedAtCore,
} from './nook-wasm/nook_wasm'

await initNookWasm()

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

const ENROLLMENT_HASH_PREFIX = '#enroll='

export async function encryptEnrollmentPayload(
  payload: EnrollmentIssueInput,
  password: string,
  entryLabel = '',
): Promise<string> {
  return encryptEnrollmentPayloadCore(
    toWasmIssueInput(payload),
    password,
    entryLabel,
  )
}

export function peekEnrollmentIssuedAt(code: string): string | undefined {
  const normalized = normalizeEnrollmentCode(code)
  return normalized
    ? (peekEnrollmentIssuedAtCore(normalized) ?? undefined)
    : undefined
}

export function peekEnrollmentEntryId(code: string): string | undefined {
  const normalized = normalizeEnrollmentCode(code)
  return normalized
    ? (peekEnrollmentEntryIdCore(normalized) ?? undefined)
    : undefined
}

export function peekEnrollmentEntryLabel(code: string): string | undefined {
  const normalized = normalizeEnrollmentCode(code)
  return normalized
    ? (peekEnrollmentEntryLabelCore(normalized) ?? undefined)
    : undefined
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
export function consumeEnrollmentFromLocation(): string | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }

  const url = new URL(window.location.href)
  let raw: string | undefined

  if (url.hash.startsWith(ENROLLMENT_HASH_PREFIX)) {
    raw = decodeURIComponent(url.hash.slice(ENROLLMENT_HASH_PREFIX.length))
    url.hash = ''
  } else {
    raw = url.searchParams.get('enroll') ?? undefined
    if (raw) {
      url.searchParams.delete('enroll')
    }
  }

  if (!raw) {
    return undefined
  }

  history.replaceState(undefined, '', `${url.pathname}${url.search}${url.hash}`)
  return normalizeEnrollmentCode(raw)
}

export async function decryptEnrollmentPayload(
  code: string,
  password: string,
): Promise<DecryptedEnrollmentPayload> {
  const decrypted = decryptEnrollmentPayloadCore(
    normalizeEnrollmentCode(code),
    password,
  )
  return {
    provider: fromWasmProvider(decrypted.provider),
    entry_id: decrypted.entryId,
    issued_at: decrypted.issuedAt,
  }
}

function toWasmIssueInput(
  payload: EnrollmentIssueInput,
): NookEnrollmentIssueInput {
  return new NookEnrollmentIssueInput(
    toWasmProvider(payload.provider),
    payload.entry_id,
    payload.issued_at,
  )
}

function toWasmProvider(provider: EnrollmentProvider): NookEnrollmentProvider {
  if (provider.type === 'github') {
    return NookEnrollmentProvider.github(provider.repo, provider.pat)
  }
  return NookEnrollmentProvider.local()
}

function fromWasmProvider(
  provider: NookEnrollmentProvider,
): EnrollmentProvider {
  if (provider.type === StorageProviderType.Github) {
    return {
      type: 'github',
      pat: provider.pat,
      repo: provider.repo,
    }
  }
  return { type: 'local' }
}
