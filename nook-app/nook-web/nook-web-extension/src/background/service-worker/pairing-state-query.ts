import { setupStorageKey } from '../pairing-grants'
import {
  extensionPairingStateQueryResponseFromStorage,
  type ExtensionPairingStateStorageResponseRequest,
  type ExtensionPairingStateQueryResponse,
} from '../../lib/pairing-state'
import { extensionPairingIdentity } from './pairing-identity'

type RuntimeMessageListener = Parameters<
  typeof chrome.runtime.onMessage.addListener
>[0]

interface PairingStateQueryContext {
  sender: chrome.runtime.MessageSender
  sendResponse: Parameters<RuntimeMessageListener>[2]
}

export function handlePairingStateQuery({
  sender,
  sendResponse,
}: PairingStateQueryContext): boolean {
  if (sender.id !== chrome.runtime.id) {
    const forbiddenResponse: ExtensionPairingStateQueryResponse = {
      ok: false,
      reason: 'forbidden-sender',
    }
    sendResponse(forbiddenResponse)
    return false
  }
  void extensionPairingIdentity
    .getPairingStorage(setupStorageKey)
    .then((stored) => {
      const storageResponseRequest: ExtensionPairingStateStorageResponseRequest =
        {
          stored,
          setupKey: setupStorageKey,
        }
      const storedStateResponse = extensionPairingStateQueryResponseFromStorage(
        storageResponseRequest,
      )
      return sendResponse(storedStateResponse)
    })
    .catch(() => {
      const failedResponse: ExtensionPairingStateQueryResponse = {
        ok: false,
        reason: 'pairing-state-read-failed',
      }
      return sendResponse(failedResponse)
    })
  return true
}
