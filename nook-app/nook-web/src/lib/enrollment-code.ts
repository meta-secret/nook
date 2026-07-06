import {
  buildEnrollmentLink as buildEnrollmentLinkCore,
  normalizeEnrollmentCode,
} from './nook-wasm/nook_wasm'

const ENROLLMENT_HASH_PREFIX = '#enroll='

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
  return buildEnrollmentLinkCore(code, baseUrl)
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
