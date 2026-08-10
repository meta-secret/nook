import {
  extensionPairingGrantPolicyReady,
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
  message: object,
): message is ExtensionPairingStateQueryMessage {
  return (
    !!message &&
    typeof message === 'object' &&
    'type' in message &&
    message.type ===
      ExtensionPairingStateQueryMessageType.NookExtensionPairingStateQuery
  )
}

export async function loadExtensionSetupState(): Promise<ExtensionSetupLoad> {
  const pairingPolicy = await extensionPairingGrantPolicyReady
  return new Promise((resolve) => {
    const queryMessage: ExtensionPairingStateQueryMessage = {
      type: ExtensionPairingStateQueryMessageType.NookExtensionPairingStateQuery,
    }
    chrome.runtime.sendMessage(queryMessage, (runtimeResponse: object) => {
      const response = runtimeResponse as Partial<{
        ok: true
        setup: ExtensionReadySetupState
      }>
      if (
        chrome.runtime.lastError ||
        !response ||
        typeof response !== 'object' ||
        !('ok' in response) ||
        response.ok !== true ||
        !('setup' in response) ||
        !pairingPolicy.isExtensionReadySetupState(response.setup)
      ) {
        const unavailable: ExtensionSetupLoad = {
          kind: ExtensionSetupLoadKind.Unavailable,
        }
        resolve(unavailable)
        return
      }
      const ready: ExtensionSetupLoad = {
        kind: ExtensionSetupLoadKind.Ready,
        setup: response.setup,
      }
      resolve(ready)
    })
  })
}
