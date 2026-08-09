import { setupStorageKey } from '../pairing-grants'
import { getPairingStorage } from './pairing-identity'

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
    const forbiddenResponse: Parameters<typeof sendResponse>[0] = {
      ok: false,
      reason: 'forbidden-sender',
    }
    sendResponse(forbiddenResponse)
    return false
  }
  void getPairingStorage(setupStorageKey)
    .then((stored) => {
      const storedStateResponse: Parameters<typeof sendResponse>[0] = {
        ok: true,
        setup: stored[setupStorageKey],
      }
      return sendResponse(storedStateResponse)
    })
    .catch(() => {
      const failedResponse: Parameters<typeof sendResponse>[0] = {
        ok: false,
        reason: 'pairing-state-read-failed',
      }
      return sendResponse(failedResponse)
    })
  return true
}
