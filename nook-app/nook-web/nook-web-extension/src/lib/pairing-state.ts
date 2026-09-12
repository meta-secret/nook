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
}

type ExtensionPairingStateLoaderPolicy = Pick<
  Awaited<typeof extensionPairingGrantPolicyReady>,
  'isExtensionReadySetupState'
>

export type ExtensionPairingStateLoaderArgs = {
  browser: typeof globalThis
  pairingPolicy: Promise<ExtensionPairingStateLoaderPolicy>
}

/** Owns the browser transport used to load the extension's pairing setup state. */
export class ExtensionPairingStateLoader {
  constructor(private readonly args: ExtensionPairingStateLoaderArgs) {}

  async loadExtensionSetupState(): Promise<ExtensionSetupLoad> {
    const pairingPolicy = await this.args.pairingPolicy
    return new Promise((resolve) => {
      const queryMessage: ExtensionPairingStateQueryMessage = {
        type: ExtensionPairingStateQueryMessageType.NookExtensionPairingStateQuery,
      }
      this.args.browser.chrome.runtime.sendMessage(
        queryMessage,
        (runtimeResponse: unknown) => {
          if (
            this.args.browser.chrome.runtime.lastError ||
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
        },
      )
    })
  }
}

export const extensionPairingStateLoader = new ExtensionPairingStateLoader({
  browser: globalThis,
  pairingPolicy: extensionPairingGrantPolicyReady,
})

export enum ExtensionSetupLoadKind {
  Ready = 'ready',
  Unavailable = 'unavailable',
}

export type ExtensionSetupLoad =
  | { kind: ExtensionSetupLoadKind.Ready; setup: ExtensionReadySetupState }
  | { kind: ExtensionSetupLoadKind.Unavailable }
