import {
  belongs_to_simple_vault,
  simple_vault_url,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { CompanionWasmSessionMessageType } from '../../../nook-web-shared/src/extension/companion-wasm-runtime-messages'
import {
  CompanionWasmRuntimeDeliveryKind,
  sendCompanionWasmRuntimeMessage,
} from '../../../nook-web-shared/src/extension/companion-wasm-runtime-transport'
import { companionWasmReadiness } from '../content/autofill/companion-wasm-readiness'

/** Browser requests await canonical policy without delaying listener registration. */
class SimpleVaultRuntime {
  private baseUrl(): string {
    return __NOOK_SIMPLE_VAULT_URL__
  }

  async runtimeSimpleVaultUrl(path = ''): Promise<string> {
    await companionWasmReadiness.wait()
    return simple_vault_url(this.baseUrl(), path)
  }
  async isRuntimeSimpleVaultUrl(candidateUrl: string): Promise<boolean> {
    await companionWasmReadiness.wait()
    try {
      return belongs_to_simple_vault(this.baseUrl(), candidateUrl)
    } catch {
      return false
    }
  }
  async isRuntimeNookVaultAppUrl(candidateUrl: string): Promise<boolean> {
    const delivery = await sendCompanionWasmRuntimeMessage(globalThis, {
      type: CompanionWasmSessionMessageType.IsNookVaultAppUrl,
      payload: { candidateUrl, baseUrl: this.baseUrl() },
      origin: globalThis.location.origin,
    })
    return (
      delivery.kind === CompanionWasmRuntimeDeliveryKind.Delivered &&
      delivery.response === true
    )
  }
}
export const simpleVaultRuntime = new SimpleVaultRuntime()
