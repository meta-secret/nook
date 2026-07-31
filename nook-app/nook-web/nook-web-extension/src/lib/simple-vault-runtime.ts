/**
 * Build-time Simple Vault helpers for the service worker and content-script
 * vault-host guard.
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

function isSimpleVaultHostname(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (host === 'simple.nokey.sh') {
    return true
  }
  if (host.startsWith('simple.') && host.endsWith('.nokey.sh')) {
    return true
  }
  return host.endsWith('.nokey-simple.pages.dev')
}

function isSentinelVaultHostname(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (host === 'sentinel.nokey.sh') {
    return true
  }
  if (host.startsWith('sentinel.') && host.endsWith('.nokey.sh')) {
    return true
  }
  return host.endsWith('.nokey-sentinel.pages.dev')
}

function matchingSentinelBaseUrl(baseUrl: string): string | undefined {
  try {
    const base = normalizeBaseUrl(baseUrl)
    const host = base.hostname
    if (host.startsWith('simple.')) {
      return `${base.protocol}//sentinel.${host.slice('simple.'.length)}/`
    }
    if (host.includes('.nokey-simple.pages.dev')) {
      return `${base.protocol}//${host.replace(
        '.nokey-simple.pages.dev',
        '.nokey-sentinel.pages.dev',
      )}/`
    }
    if (base.pathname.endsWith('/simple/')) {
      return new URL(
        `${base.pathname.slice(0, -'/simple/'.length)}/sentinel/`,
        base,
      ).href
    }
  } catch {
    return undefined
  }
  return undefined
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

/** True for any Simple/Sentinel Nook host, not only this build's channel. */
export function isRuntimeNookVaultAppUrl(candidateUrl: string): boolean {
  try {
    const candidate = new URL(candidateUrl)
    if (
      isSimpleVaultHostname(candidate.hostname) ||
      isSentinelVaultHostname(candidate.hostname)
    ) {
      return true
    }
    if (isRuntimeSimpleVaultUrl(candidateUrl)) {
      return true
    }
    const sentinelBase = matchingSentinelBaseUrl(SIMPLE_VAULT_BASE_URL)
    if (!sentinelBase) {
      return false
    }
    const base = normalizeBaseUrl(sentinelBase)
    return (
      candidate.origin === base.origin &&
      candidate.pathname.startsWith(base.pathname)
    )
  } catch {
    return false
  }
}
