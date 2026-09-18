import { Schema } from 'effect'
import {
  extensionPairingGrantPolicyReady,
  type ExtensionReadySetupState,
} from '../background/pairing-grants'
import {
  ConcreteDecoderResultKind,
  runConcreteDecoder,
} from './concrete-decoder'

export enum ExtensionPairingStateQueryMessageType {
  NookExtensionPairingStateQuery = 'nook:extension-pairing-state-query',
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class ExtensionPairingStateQueryMessage {
  private constructor() {}
  declare readonly type: ExtensionPairingStateQueryMessageType.NookExtensionPairingStateQuery
  static decode(message: unknown) {
    return Schema.decodeUnknown(extensionPairingStateQueryMessageSchema)(
      message,
    )
  }
}

type ExtensionPairingStateQueryMessageSchemaFields = {
  readonly type: Schema.Schema<ExtensionPairingStateQueryMessage['type']>
}

const extensionPairingStateQueryMessageSchemaFields: ExtensionPairingStateQueryMessageSchemaFields =
  {
    type: Schema.Literal(
      ExtensionPairingStateQueryMessageType.NookExtensionPairingStateQuery,
    ),
  }

const extensionPairingStateQueryMessageSchema = Schema.Struct(
  extensionPairingStateQueryMessageSchemaFields,
) satisfies Schema.Schema<ExtensionPairingStateQueryMessage>

type ExtensionPairingStateLoaderPolicy = Pick<
  Awaited<typeof extensionPairingGrantPolicyReady>,
  'decodeExtensionReadySetupState'
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
            !('setup' in runtimeResponse)
          ) {
            const unavailable: ExtensionSetupLoad = {
              kind: ExtensionSetupLoadKind.Unavailable,
            }
            resolve(unavailable)
            return
          }
          const setup = runConcreteDecoder(
            pairingPolicy.decodeExtensionReadySetupState,
            runtimeResponse.setup,
          )
          if (setup.kind === ConcreteDecoderResultKind.Rejected) {
            const unavailable: ExtensionSetupLoad = {
              kind: ExtensionSetupLoadKind.Unavailable,
            }
            resolve(unavailable)
            return
          }
          const ready: ExtensionSetupLoad = {
            kind: ExtensionSetupLoadKind.Ready,
            setup: setup.value,
          }
          resolve(ready)
        },
      )
    })
  }
}

const extensionPairingStateLoaderArgs: ExtensionPairingStateLoaderArgs = {
  browser: globalThis,
  pairingPolicy: extensionPairingGrantPolicyReady,
}
export const extensionPairingStateLoader = new ExtensionPairingStateLoader(
  extensionPairingStateLoaderArgs,
)

export enum ExtensionSetupLoadKind {
  Ready = 'ready',
  Unavailable = 'unavailable',
}

export type ExtensionSetupLoad =
  | { kind: ExtensionSetupLoadKind.Ready; setup: ExtensionReadySetupState }
  | { kind: ExtensionSetupLoadKind.Unavailable }
