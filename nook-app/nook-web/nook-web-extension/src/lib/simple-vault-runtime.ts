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

enum MatchingSentinelBaseKind {
  Absent = 'absent',
  Present = 'present',
}

type MatchingSentinelBase =
  | { kind: MatchingSentinelBaseKind.Absent }
  | { kind: MatchingSentinelBaseKind.Present; url: string }

/** Owns the configured Simple Vault deployment URL and its browser routes. */
class SimpleVaultRuntime {
  constructor(private readonly baseUrl: string) {}

  private normalizeBaseUrl(value: string): URL {
    const url = new URL(value)
    url.hash = ''
    url.search = ''
    if (!url.pathname.endsWith('/')) {
      url.pathname = `${url.pathname}/`
    }
    return url
  }

  private isRuntimeSimpleVaultHostname(hostname: string): boolean {
    const host = hostname.toLowerCase()
    if (host === 'simple.nokey.sh') {
      return true
    }
    if (host.startsWith('simple.') && host.endsWith('.nokey.sh')) {
      return true
    }
    return host.endsWith('.nokey-simple.pages.dev')
  }

  private isRuntimeSentinelVaultHostname(hostname: string): boolean {
    const host = hostname.toLowerCase()
    if (host === 'sentinel.nokey.sh') {
      return true
    }
    if (host.startsWith('sentinel.') && host.endsWith('.nokey.sh')) {
      return true
    }
    return host.endsWith('.nokey-sentinel.pages.dev')
  }

  private matchingSentinelBaseUrl(baseUrl: string): MatchingSentinelBase {
    try {
      const base = this.normalizeBaseUrl(baseUrl)
      const host = base.hostname
      if (host.startsWith('simple.')) {
        return {
          kind: MatchingSentinelBaseKind.Present,
          url: `${base.protocol}//sentinel.${host.slice('simple.'.length)}/`,
        }
      }
      if (host.includes('.nokey-simple.pages.dev')) {
        return {
          kind: MatchingSentinelBaseKind.Present,
          url: `${base.protocol}//${host.replace(
            '.nokey-simple.pages.dev',
            '.nokey-sentinel.pages.dev',
          )}/`,
        }
      }
      if (base.pathname.endsWith('/simple/')) {
        return {
          kind: MatchingSentinelBaseKind.Present,
          url: new URL(
            `${base.pathname.slice(0, -'/simple/'.length)}/sentinel/`,
            base,
          ).href,
        }
      }
    } catch {
      return { kind: MatchingSentinelBaseKind.Absent }
    }
    return { kind: MatchingSentinelBaseKind.Absent }
  }

  runtimeSimpleVaultUrl(path = ''): string {
    const base = this.normalizeBaseUrl(this.baseUrl)
    if (!path) {
      return base.href
    }
    const normalized = path.startsWith('/') ? path.slice(1) : path
    return new URL(normalized, base).href
  }

  isRuntimeSimpleVaultUrl(candidateUrl: string): boolean {
    try {
      const base = this.normalizeBaseUrl(this.baseUrl)
      const candidate = new URL(candidateUrl)
      return (
        candidate.origin === base.origin &&
        candidate.pathname.startsWith(base.pathname)
      )
    } catch {
      return false
    }
  }

  isRuntimeNookVaultAppUrl(candidateUrl: string): boolean {
    try {
      const candidate = new URL(candidateUrl)
      if (
        this.isRuntimeSimpleVaultHostname(candidate.hostname) ||
        this.isRuntimeSentinelVaultHostname(candidate.hostname)
      ) {
        return true
      }
      if (this.isRuntimeSimpleVaultUrl(candidateUrl)) {
        return true
      }
      const sentinelBase = this.matchingSentinelBaseUrl(this.baseUrl)
      if (sentinelBase.kind !== MatchingSentinelBaseKind.Present) {
        return false
      }
      const base = this.normalizeBaseUrl(sentinelBase.url)
      return (
        candidate.origin === base.origin &&
        candidate.pathname.startsWith(base.pathname)
      )
    } catch {
      return false
    }
  }
}

export const simpleVaultRuntime = new SimpleVaultRuntime(SIMPLE_VAULT_BASE_URL)
