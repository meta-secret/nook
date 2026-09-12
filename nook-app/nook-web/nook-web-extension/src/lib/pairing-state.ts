import {
  extensionPairingGrantPolicyReady,
  type ExtensionReadySetupState,
} from '../background/pairing-grants'

export enum ExtensionPairingStateQueryMessageType {
  NookExtensionPairingStateQuery = 'nook:extension-pairing-state-query',
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class ExtensionPairingStateQueryMessage {
  private constructor() {}
  declare readonly type: ExtensionPairingStateQueryMessageType.NookExtensionPairingStateQuery
  static is(message: unknown): message is ExtensionPairingStateQueryMessage {
    return (
      !!message &&
      typeof message === 'object' &&
      'type' in message &&
      message.type ===
        ExtensionPairingStateQueryMessageType.NookExtensionPairingStateQuery
    )
  }

  static async loadExtensionSetupState(): Promise<ExtensionSetupLoad> {
    const pairingPolicy = await extensionPairingGrantPolicyReady
    return new Promise((resolve) => {
      const queryMessage: ExtensionPairingStateQueryMessage = {
        type: ExtensionPairingStateQueryMessageType.NookExtensionPairingStateQuery,
      }
      chrome.runtime.sendMessage(queryMessage, (runtimeResponse: unknown) => {
        if (
          chrome.runtime.lastError ||
          !runtimeResponse ||
          typeof runtimeResponse !== 'object' ||
          !('ok' in runtimeResponse) ||
          runtimeResponse.ok !== true ||
          !('setup' in runtimeResponse) ||
          !pairingPolicy.isExtensionReadySetupState(runtimeResponse.setup)
        ) {
          const unavailable: ExtensionSetupLoad = {
            kind: ExtensionSetupLoadKind.Unavailable,
          }
          resolve(unavailable)
          return
        }
        const ready: ExtensionSetupLoad = {
          kind: ExtensionSetupLoadKind.Ready,
          setup: runtimeResponse.setup,
        }
        resolve(ready)
      })
    })
  }
}

export enum ExtensionSetupLoadKind {
  Ready = 'ready',
  Unavailable = 'unavailable',
}

export type ExtensionSetupLoad =
  | { kind: ExtensionSetupLoadKind.Ready; setup: ExtensionReadySetupState }
  | { kind: ExtensionSetupLoadKind.Unavailable }
