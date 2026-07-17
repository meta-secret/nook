export const DEFAULT_SIMPLE_VAULT_URL = 'https://simple.nokey.sh/'

/** Channel-agnostic match patterns for every Simple/Sentinel Nook host. */
const NOOK_VAULT_APP_EXCLUDE_MATCH_PATTERNS = [
  'https://simple.nokey.sh/*',
  'https://simple.dev.nokey.sh/*',
  'https://sentinel.nokey.sh/*',
  'https://sentinel.dev.nokey.sh/*',
  'https://*.nokey-simple.pages.dev/*',
  'https://*.nokey-sentinel.pages.dev/*',
] as const

export function normalizeSimpleVaultBaseUrl(value: string): string {
  const url = new URL(value)
  const localHttp =
    url.protocol === 'http:' &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
  if (url.protocol !== 'https:' && !localHttp) {
    throw new Error(
      'The Simple Vault URL must use HTTPS, except for localhost development.',
    )
  }

  url.hash = ''
  url.search = ''
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/`
  return url.toString()
}

export function simpleVaultUrl(baseUrl: string, path = ''): string {
  const normalized = normalizeSimpleVaultBaseUrl(baseUrl)
  return new URL(path.replace(/^\/+/, ''), normalized).toString()
}

export function simpleVaultMatchPattern(baseUrl: string): string {
  const url = new URL(normalizeSimpleVaultBaseUrl(baseUrl))
  return `${url.origin}${url.pathname}*`
}

export function matchingSentinelVaultBaseUrl(
  baseUrl: string,
): string | undefined {
  const url = new URL(normalizeSimpleVaultBaseUrl(baseUrl))
  if (url.hostname.startsWith('simple.')) {
    return `${url.protocol}//sentinel.${url.hostname.slice('simple.'.length)}/`
  }
  if (url.hostname.includes('.nokey-simple.pages.dev')) {
    return `${url.protocol}//${url.hostname.replace(
      '.nokey-simple.pages.dev',
      '.nokey-sentinel.pages.dev',
    )}/`
  }
  if (url.pathname.endsWith('/simple/')) {
    const sentinelPath = `${url.pathname.slice(0, -'/simple/'.length)}/sentinel/`
    return `${url.origin}${sentinelPath.replace(/^\/\//, '/')}`
  }
  return undefined
}

export function sentinelVaultMatchPatterns(baseUrl: string): string[] {
  const matchingSentinel = matchingSentinelVaultBaseUrl(baseUrl)
  const matches = ['https://sentinel.nokey.sh/*']
  if (matchingSentinel) matches.push(`${matchingSentinel}*`)
  return [...new Set(matches)]
}

export function isSimpleVaultHostname(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (host === 'simple.nokey.sh') return true
  if (host.startsWith('simple.') && host.endsWith('.nokey.sh')) return true
  return host.endsWith('.nokey-simple.pages.dev')
}

export function isSentinelVaultHostname(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (host === 'sentinel.nokey.sh') return true
  if (host.startsWith('sentinel.') && host.endsWith('.nokey.sh')) return true
  return host.endsWith('.nokey-sentinel.pages.dev')
}

/**
 * Autofill / website-WebAuthn exclusions for every Simple and Sentinel host,
 * plus the build's configured Simple/Sentinel patterns (covers legacy path
 * isolation on shared preview hosts).
 */
export function nookVaultAppExcludeMatchPatterns(baseUrl: string): string[] {
  return [
    ...new Set([
      ...NOOK_VAULT_APP_EXCLUDE_MATCH_PATTERNS,
      simpleVaultMatchPattern(baseUrl),
      ...sentinelVaultMatchPatterns(baseUrl),
    ]),
  ]
}

export function isNookVaultAppUrl(
  candidateUrl: string,
  baseUrl?: string,
): boolean {
  try {
    const url = new URL(candidateUrl)
    if (
      isSimpleVaultHostname(url.hostname) ||
      isSentinelVaultHostname(url.hostname)
    ) {
      return true
    }
    if (!baseUrl) return false
    return (
      belongsToSimpleVault(baseUrl, candidateUrl) ||
      belongsToSentinelVault(baseUrl, candidateUrl)
    )
  } catch {
    return false
  }
}

export function belongsToSimpleVault(
  baseUrl: string,
  candidateUrl: string,
): boolean {
  const base = new URL(normalizeSimpleVaultBaseUrl(baseUrl))
  const candidate = new URL(candidateUrl)
  return (
    candidate.origin === base.origin &&
    candidate.pathname.startsWith(base.pathname)
  )
}

export function belongsToSentinelVault(
  baseUrl: string,
  candidateUrl: string,
): boolean {
  return sentinelVaultMatchPatterns(baseUrl).some((pattern) => {
    const prefix = pattern.slice(0, -1)
    return candidateUrl.startsWith(prefix)
  })
}
