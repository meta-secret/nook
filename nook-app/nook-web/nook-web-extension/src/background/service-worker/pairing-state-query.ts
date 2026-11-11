import { extensionPairingGrantPolicyReady } from '../pairing-grants'
import {
  extensionPairingStateQueryResponse,
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

/** Rust reads the connection from the whole pairing storage, so a joined
 * keyring with no vault yet is not answered as no connection. */
async function pairingStateQueryResponse(): Promise<ExtensionPairingStateQueryResponse> {
  const policy = await extensionPairingGrantPolicyReady
  const stored = await extensionPairingIdentity.getPairingStorage()
  return extensionPairingStateQueryResponse(policy.vaultConnection(stored))
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
  void pairingStateQueryResponse()
    .then((response) => sendResponse(response))
    .catch(() => {
      const failedResponse: ExtensionPairingStateQueryResponse = {
        ok: false,
        reason: 'pairing-state-read-failed',
      }
      return sendResponse(failedResponse)
    })
  return true
}
