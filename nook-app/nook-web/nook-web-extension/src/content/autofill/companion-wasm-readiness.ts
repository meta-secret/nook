import { CompanionWasmSessionMessageType } from '../../../../nook-web-shared/src/extension/companion-wasm-runtime-messages'
import {
  CompanionWasmRuntimeDeliveryKind,
  sendCompanionWasmRuntimeMessage,
} from '../../../../nook-web-shared/src/extension/companion-wasm-runtime-transport'

/** Owns extension runtime readiness and lazy legacy response decoder startup. */
class CompanionWasmReadiness {
  async waitForExtensionClassification(): Promise<void> {
    const delivery = await sendCompanionWasmRuntimeMessage(globalThis, {
      type: CompanionWasmSessionMessageType.ClassifyPageInputs,
      origin: globalThis.location.origin,
      payload: { fields: [], labels: [] },
    })
    if (delivery.kind === CompanionWasmRuntimeDeliveryKind.Delivered) {
      const response = delivery.response
      if (
        response &&
        typeof response === 'object' &&
        'fields' in response &&
        Array.isArray(response.fields) &&
        response.fields.length === 0 &&
        'labels' in response &&
        Array.isArray(response.labels) &&
        response.labels.length === 0 &&
        'strongestAuthenticationUsernameEvidence' in response &&
        response.strongestAuthenticationUsernameEvidence === 'absent'
      )
        return
    }
    throw new Error('Extension companion classification runtime unavailable.')
  }

  async wait(): Promise<void> {
    const { companionWasmReady } =
      await import('../../../../nook-web-shared/src/extension/companion-ready')
    await companionWasmReady
  }
}

export const companionWasmReadiness = new CompanionWasmReadiness()
