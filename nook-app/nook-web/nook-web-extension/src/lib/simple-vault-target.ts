import {
  default_simple_vault_url,
  matching_sentinel_vault_base_url,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

/** Build callers acquire companion readiness before generating deployment metadata. */
export class SimpleVaultTarget {
  constructor(private readonly baseUrl: string) {}
  get sentinelBase(): string {
    const matching = matching_sentinel_vault_base_url(this.baseUrl)
    if (matching) return matching
    throw new Error(
      `No matching Sentinel Vault URL for this Simple Vault base: ${this.baseUrl}`,
    )
  }
  static defaultBase(): string {
    return default_simple_vault_url()
  }
}
