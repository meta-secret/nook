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

export enum ExtensionSetupLoadKind {
  Ready = 'ready',
  Unavailable = 'unavailable',
}

export type ExtensionSetupLoad =
  | { kind: ExtensionSetupLoadKind.Ready; setup: ExtensionReadySetupState }
  | { kind: ExtensionSetupLoadKind.Unavailable }

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

export function loadExtensionSetupState(): Promise<ExtensionSetupLoad> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      {
        type: ExtensionPairingStateQueryMessageType.NookExtensionPairingStateQuery,
      },
      (response: unknown) => {
        if (
          chrome.runtime.lastError ||
          !response ||
          typeof response !== 'object' ||
          !('ok' in response) ||
          response.ok !== true ||
          !('setup' in response) ||
          !isExtensionReadySetupState(response.setup)
        ) {
          resolve({ kind: ExtensionSetupLoadKind.Unavailable })
          return
        }
        resolve({ kind: ExtensionSetupLoadKind.Ready, setup: response.setup })
      },
    )
  })
}
