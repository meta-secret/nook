import { companionWasmReady } from '../../../nook-web-shared/src/extension/companion-ready'
import {
  belongs_to_simple_vault,
  is_nook_vault_app_url,
  simple_vault_url,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

/** Browser requests await canonical policy without delaying listener registration. */
class SimpleVaultRuntime {
  private baseUrl(): string {
    return __NOOK_SIMPLE_VAULT_URL__
  }

  async runtimeSimpleVaultUrl(path = ''): Promise<string> {
    await companionWasmReady
    return simple_vault_url(this.baseUrl(), path)
  }
  async isRuntimeSimpleVaultUrl(candidateUrl: string): Promise<boolean> {
    await companionWasmReady
    try {
      return belongs_to_simple_vault(this.baseUrl(), candidateUrl)
    } catch {
      return false
    }
  }
  async isRuntimeNookVaultAppUrl(candidateUrl: string): Promise<boolean> {
    await companionWasmReady
    try {
      return is_nook_vault_app_url(candidateUrl, this.baseUrl())
    } catch {
      return false
    }
  }
}
export const simpleVaultRuntime = new SimpleVaultRuntime()
