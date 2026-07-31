/**
 * Build-time Simple Vault helpers for the service worker.
 *
 * Keep this module free of companion-ready / companion WASM imports. The
 * service worker must register message handlers even if companion WASM is
 * still loading for content scripts.
 */

/** Build-time normalized Simple Vault base from the extension define. */
export const SIMPLE_VAULT_BASE_URL = __NOOK_SIMPLE_VAULT_URL__

function normalizeBaseUrl(value: string): URL {
  const url = new URL(value)
  url.hash = ''
  url.search = ''
  if (!url.pathname.endsWith('/')) {
    url.pathname = `${url.pathname}/`
  }
  return url
}

export function runtimeSimpleVaultUrl(path = ''): string {
  const base = normalizeBaseUrl(SIMPLE_VAULT_BASE_URL)
  if (!path) {
    return base.href
  }
  const normalized = path.startsWith('/') ? path.slice(1) : path
  return new URL(normalized, base).href
}

export function isRuntimeSimpleVaultUrl(candidateUrl: string): boolean {
  try {
    const base = normalizeBaseUrl(SIMPLE_VAULT_BASE_URL)
    const candidate = new URL(candidateUrl)
    return (
      candidate.origin === base.origin &&
      candidate.pathname.startsWith(base.pathname)
    )
  } catch {
    return false
  }
}
