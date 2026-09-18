import { ExtensionLocalEventLogUpdatedMessage as ExtensionLocalEventLogUpdatedMessageSchema } from '../../../nook-web-shared/src/extension/lifecycle-runtime-messages'
import { companionWasmReady } from '../../../nook-web-shared/src/extension/companion-ready'
import {
  ConcreteDecoderResultKind,
  runConcreteDecoder,
} from '../lib/concrete-decoder'
import {
  SerializedWireSnapshotKind,
  SerializedWireValueAdapter,
} from '../lib/serialized-wire-value-adapter'

const extensionRuntimeIdAttribute = 'data-nook-extension-runtime-id'

void companionWasmReady.then(() => {
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window || event.origin !== window.location.origin)
      return

    const data: unknown = event.data
    const eventLogRecordsSnapshot =
      SerializedWireValueAdapter.snapshotEventLogRecords(data)
    if (eventLogRecordsSnapshot.kind === SerializedWireSnapshotKind.Missing)
      return
    const message = runConcreteDecoder(
      ExtensionLocalEventLogUpdatedMessageSchema.decode,
      data,
    )
    if (message.kind === ConcreteDecoderResultKind.Decoded) {
      const preservedEventLogRecords =
        SerializedWireValueAdapter.restoreEventLogRecords<
          typeof message.value.payload.eventLogRecords
        >(eventLogRecordsSnapshot.value)
      const deliveryMessage: typeof message.value = {
        ...message.value,
        payload: {
          ...message.value.payload,
          eventLogRecords: preservedEventLogRecords,
        },
      }
      chrome.runtime.sendMessage(deliveryMessage, () => {
        // The bridge is best-effort when the vault is not paired. Reading
        // lastError prevents an expected unloaded/reloaded worker response from
        // becoming an unhandled console error.
        void chrome.runtime.lastError
      })
    }
  })
})

function publishExtensionRuntimeId(): boolean {
  const root = document.documentElement
  if (!root) return false
  root.setAttribute(extensionRuntimeIdAttribute, chrome.runtime.id)
  return true
}

if (!publishExtensionRuntimeId()) {
  const observer = new MutationObserver(() => {
    if (!publishExtensionRuntimeId()) return
    observer.disconnect()
  })
  const nookTypedArgs0_0: Parameters<typeof observer.observe>[1] = {
    childList: true,
  }
  observer.observe(document, nookTypedArgs0_0)
}
