import { companionWasmReady } from '../../../nook-web-shared/src/extension/companion-ready'

void companionWasmReady
import {
  default_simple_vault_url,
  matching_sentinel_vault_base_url,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

enum MatchingSentinelBaseKind {
  Absent = 'absent',
  Present = 'present',
}

type MatchingSentinelBase =
  | { kind: MatchingSentinelBaseKind.Absent }
  | { kind: MatchingSentinelBaseKind.Present; url: string }

/** WASM-free fallback; keep rules aligned with simple-vault-runtime. */

export class SimpleVaultTarget {
  constructor(private readonly request: string) {}
  get sentinelBase(): string {
    const baseUrl = this.request

    const matching = matching_sentinel_vault_base_url(baseUrl)
    if (matching) {
      return matching
    }
    // Node e2e can hit an empty wasm result after long companion use; keep the
    // same host-pairing rules as the WASM-free service-worker helper.
    const fallback = this.matchingSentinelBaseUrlFallback()
    if (fallback.kind === MatchingSentinelBaseKind.Present) {
      return fallback.url
    }
    throw new Error(
      `No matching Sentinel Vault URL for this Simple Vault base: ${baseUrl}`,
    )
  }
  static defaultBase(): string {
    return default_simple_vault_url()
  }
  private matchingSentinelBaseUrlFallback(): MatchingSentinelBase {
    const baseUrl = this.request
    try {
      const base = new URL(baseUrl)
      base.hash = ''
      base.search = ''
      if (!base.pathname.endsWith('/')) {
        base.pathname = `${base.pathname}/`
      }
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
}
