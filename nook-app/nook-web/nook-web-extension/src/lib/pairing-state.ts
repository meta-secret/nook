import {
  isExtensionReadySetupState,
  type ExtensionReadySetupState,
} from '../background/pairing-grants'

export enum ExtensionPairingStateQueryMessageType {
  NookExtensionPairingStateQuery = 'nook:extension-pairing-state-query',
}

export type ExtensionPairingStateQueryMessage = {
  type: ExtensionPairingStateQueryMessageType.NookExtensionPairingStateQuery
}

export function isExtensionPairingStateQueryMessage(
  message: unknown,
): message is ExtensionPairingStateQueryMessage {
  return (
    !!message &&
    typeof message === 'object' &&
    'type' in message &&
    message.type ===
      ExtensionPairingStateQueryMessageType.NookExtensionPairingStateQuery
  )
}

export function loadExtensionSetupState(): Promise<ExtensionReadySetupState | void> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      {
        type: ExtensionPairingStateQueryMessageType.NookExtensionPairingStateQuery,
      },
      (response: { ok?: boolean; setup?: unknown } | void) => {
        if (
          chrome.runtime.lastError ||
          response?.ok !== true ||
          !isExtensionReadySetupState(response.setup)
        ) {
          resolve()
          return
        }
        resolve(response.setup)
      },
    )
  })
}
