export const DEFAULT_SIMPLE_VAULT_URL = 'https://simple.nokey.sh/'

const PRODUCTION_SENTINEL_MATCH = 'https://sentinel.nokey.sh/*'

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

export function sentinelVaultMatchPatterns(baseUrl: string): string[] {
  const url = new URL(normalizeSimpleVaultBaseUrl(baseUrl))
  const matches = [PRODUCTION_SENTINEL_MATCH]
  if (url.pathname.endsWith('/simple/')) {
    const sentinelPath = `${url.pathname.slice(0, -'/simple/'.length)}/sentinel/`
    matches.push(`${url.origin}${sentinelPath.replace(/^\/\//, '/')}*`)
  }
  return [...new Set(matches)]
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
