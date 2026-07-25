import {
  isExtensionReadySetupState,
  type ExtensionReadySetupState,
} from '../background/pairing-grants'

export type ExtensionPairingStateQueryMessage = {
  type: 'nook:extension-pairing-state-query'
}

export function isExtensionPairingStateQueryMessage(
  message: unknown,
): message is ExtensionPairingStateQueryMessage {
  return (
    !!message &&
    typeof message === 'object' &&
    'type' in message &&
    message.type === 'nook:extension-pairing-state-query'
  )
}

export function loadExtensionSetupState(): Promise<
  ExtensionReadySetupState | undefined
> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: 'nook:extension-pairing-state-query' },
      (response: { ok?: boolean; setup?: unknown } | undefined) => {
        if (
          chrome.runtime.lastError ||
          response?.ok !== true ||
          !isExtensionReadySetupState(response.setup)
        ) {
          resolve(undefined)
          return
        }
        resolve(response.setup)
      },
    )
  })
}
