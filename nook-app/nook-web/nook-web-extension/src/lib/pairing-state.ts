/* eslint-disable no-restricted-syntax -- This dedicated storage decoder uses a predicate to narrow untrusted persisted state. */
import { Schema } from 'effect'
import type { ExtensionReadySetup as ExtensionReadySetupState } from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

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

export type ExtensionPairingStateLoaderArgs = {
  browser: typeof globalThis
}

function isExtensionReadySetupState(
  value: unknown,
): value is ExtensionReadySetupState {
  return (
    !!value &&
    typeof value === 'object' &&
    'status' in value &&
    value.status === 'ready' &&
    'deviceLabel' in value &&
    typeof value.deviceLabel === 'string' &&
    'pairedVaults' in value &&
    Array.isArray(value.pairedVaults) &&
    'selectedVaultStoreId' in value &&
    typeof value.selectedVaultStoreId === 'string' &&
    'selectedVaultName' in value &&
    typeof value.selectedVaultName === 'string' &&
    'syncProviderCount' in value &&
    typeof value.syncProviderCount === 'number' &&
    'eventCount' in value &&
    typeof value.eventCount === 'number' &&
    'eventLogHeads' in value &&
    Array.isArray(value.eventLogHeads) &&
    'lastLocalSyncAt' in value &&
    typeof value.lastLocalSyncAt === 'string'
  )
}

/** Owns the browser transport used to load the extension's pairing setup state. */
export class ExtensionPairingStateLoader {
  constructor(private readonly args: ExtensionPairingStateLoaderArgs) {}

  async loadExtensionSetupState(): Promise<ExtensionSetupLoad> {
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
            !Object.hasOwn(runtimeResponse, 'setup')
          ) {
            const unavailable: ExtensionSetupLoad = {
              kind: ExtensionSetupLoadKind.Unavailable,
            }
            resolve(unavailable)
            return
          }
          if (Schema.is(Schema.Null)(runtimeResponse.setup)) {
            const notConnected: ExtensionSetupLoad = {
              kind: ExtensionSetupLoadKind.NotConnected,
            }
            resolve(notConnected)
            return
          }
          if (!isExtensionReadySetupState(runtimeResponse.setup)) {
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

const extensionPairingStateLoaderArgs: ExtensionPairingStateLoaderArgs = {
  browser: globalThis,
}
export const extensionPairingStateLoader = new ExtensionPairingStateLoader(
  extensionPairingStateLoaderArgs,
)

export enum ExtensionSetupLoadKind {
  Ready = 'ready',
  NotConnected = 'not-connected',
  Unavailable = 'unavailable',
}

export type ExtensionSetupLoad =
  | { kind: ExtensionSetupLoadKind.Ready; setup: ExtensionReadySetupState }
  | { kind: ExtensionSetupLoadKind.NotConnected }
  | { kind: ExtensionSetupLoadKind.Unavailable }
