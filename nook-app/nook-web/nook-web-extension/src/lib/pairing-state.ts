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

export enum ExtensionPairingSetupResponseKind {
  NotConnected = 'not-connected',
  Ready = 'ready',
}

/**
 * Internal response for the service worker and content script shipped in one
 * extension build. Untagged replies from an older bundle fail closed as
 * Unavailable; this contract has no legacy fallback or external versioning.
 */
export type ExtensionPairingStateQueryResponse =
  | {
      readonly ok: true
      readonly setupState: ExtensionPairingSetupResponseKind.NotConnected
    }
  | {
      readonly ok: true
      readonly setupState: ExtensionPairingSetupResponseKind.Ready
      readonly setup: ExtensionReadySetupState
    }
  | { readonly ok: false; readonly reason: string }

export function extensionPairingStateQueryResponseFromStorage(
  stored: Readonly<Record<string, unknown>>,
  setupKey: string,
): ExtensionPairingStateQueryResponse {
  if (!Object.hasOwn(stored, setupKey)) {
    return {
      ok: true,
      setupState: ExtensionPairingSetupResponseKind.NotConnected,
    }
  }
  const setup = stored[setupKey]
  if (!isExtensionReadySetupState(setup)) {
    return { ok: false, reason: 'pairing-state-invalid' }
  }
  return {
    ok: true,
    setupState: ExtensionPairingSetupResponseKind.Ready,
    setup,
  }
}

export function isExtensionReadySetupState(
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
            !Object.hasOwn(runtimeResponse, 'ok') ||
            runtimeResponse.ok !== true ||
            !('setupState' in runtimeResponse) ||
            !Object.hasOwn(runtimeResponse, 'setupState')
          ) {
            const unavailable: ExtensionSetupLoad = {
              kind: ExtensionSetupLoadKind.Unavailable,
            }
            resolve(unavailable)
            return
          }
          switch (runtimeResponse.setupState) {
            case ExtensionPairingSetupResponseKind.NotConnected: {
              const notConnected: ExtensionSetupLoad = hasExactResponseFields(runtimeResponse, [
                'ok',
                'setupState',
              ])
                ? { kind: ExtensionSetupLoadKind.NotConnected }
                : { kind: ExtensionSetupLoadKind.Unavailable }
              resolve(notConnected)
              return
            }
            case ExtensionPairingSetupResponseKind.Ready: {
              if (
                !hasExactResponseFields(runtimeResponse, [
                  'ok',
                  'setupState',
                  'setup',
                ]) ||
                !('setup' in runtimeResponse) ||
                !isExtensionReadySetupState(runtimeResponse.setup)
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
              return
            }
            default: {
              const unavailable: ExtensionSetupLoad = {
                kind: ExtensionSetupLoadKind.Unavailable,
              }
              resolve(unavailable)
              return
            }
          }
        },
      )
    })
  }
}

function hasExactResponseFields(
  response: object,
  expectedFields: readonly string[],
): boolean {
  const responseFields = Object.keys(response)
  return (
    responseFields.length === expectedFields.length &&
    expectedFields.every((field) => Object.hasOwn(response, field))
  )
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
