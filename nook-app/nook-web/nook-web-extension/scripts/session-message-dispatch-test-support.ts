import { beforeAll } from 'bun:test'
import { companionWasmReady } from '../../nook-web-shared/src/extension/companion-ready'
import {
  ExtensionSessionMessageType,
  ExtensionSessionMessageDispatcher,
} from '../src/offscreen/session-message-dispatch'
import {
  ExtensionSessionRequestParseKind,
  MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
  parseExtensionSessionRequest,
  type ExtensionSessionQueue,
  type ParsedExtensionSessionTransportRequest,
} from '../src/offscreen/session-request-adapter'
import initNookWasm, {
  type NookVaultManager,
  type StorageProvider,
} from '../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import {
  BrowserRuntimeMessage,
  BrowserRuntimeMessageAdmissionKind,
} from '../src/lib/browser-runtime-message'

beforeAll(async () => {
  await companionWasmReady
  await initNookWasm({
    module_or_path: await Bun.file(
      new URL(
        '../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm_bg.wasm',
        import.meta.url,
      ),
    ).arrayBuffer(),
  })
})
class SessionMessageWireFixture {
  pin(message: ParsedExtensionSessionTransportRequest): string {
    if (
      message.type !== ExtensionSessionMessageType.CreatePin &&
      message.type !== ExtensionSessionMessageType.UnlockPin
    ) {
      throw new TypeError('test request does not contain a PIN')
    }
    return message.payload.pin
  }

  loginSave(message: ParsedExtensionSessionTransportRequest): {
    username: string
    password: string
    origin: string
  } {
    if (message.type !== ExtensionSessionMessageType.PlanLoginSave) {
      throw new TypeError('test request is not a login-save plan')
    }
    return {
      username: message.payload.username,
      password: message.payload.password,
      origin: message.payload.origin,
    }
  }

  passkeyRequestJson(message: ParsedExtensionSessionTransportRequest): string {
    if (
      message.type !== ExtensionSessionMessageType.RegisterPasskey &&
      message.type !== ExtensionSessionMessageType.AssertPasskey
    ) {
      throw new TypeError('test request is not a passkey request')
    }
    return message.payload.requestJson
  }

  providers(
    message: ParsedExtensionSessionTransportRequest,
  ): StorageProvider[] {
    if (message.type !== ExtensionSessionMessageType.ImportVault) {
      throw new TypeError('test request is not a vault import')
    }
    return message.payload.providers
  }

  readonly decodeProviders = async (
    providers: StorageProvider[],
  ): Promise<StorageProvider[]> => structuredClone(providers)
}
const sessionMessageWireFixture = new SessionMessageWireFixture()
const decodeProviders = sessionMessageWireFixture.decodeProviders
function githubProvider(token: string): StorageProvider {
  return {
    id: 'github',
    type: 'github',
    label: 'GitHub',
    githubPat: { state: 'token', value: token },
    githubRepo: { state: 'defaultRepository' },
    oauthFile: { state: 'notApplicable' },
    localFolder: { state: 'notApplicable' },
    storeId: { state: 'unscoped' },
    syncCheckpoint: { state: 'neverSynced' },
    createdAt: '2026-08-10T00:00:00.000Z',
  }
}
function vaultImportRequest(
  providers: StorageProvider[],
  queue: ExtensionSessionQueue = MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
): Extract<
  ParsedExtensionSessionTransportRequest,
  { type: typeof ExtensionSessionMessageType.ImportVault }
> {
  return {
    type: ExtensionSessionMessageType.ImportVault,
    payload: {
      vaultStoreId: 'store_abcdefghijk',
      deviceId: 'device',
      devicePublicKey: 'public',
      deviceSigningPublicKey: 'signing',
      providers,
      eventLogRecords: [],
      queue,
    },
  }
}

export {
  BrowserRuntimeMessage,
  BrowserRuntimeMessageAdmissionKind,
  ExtensionSessionMessageDispatcher,
  ExtensionSessionMessageType,
  ExtensionSessionRequestParseKind,
  MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
  decodeProviders,
  githubProvider,
  parseExtensionSessionRequest,
  sessionMessageWireFixture,
  vaultImportRequest,
}

export type {
  ExtensionSessionQueue,
  NookVaultManager,
  ParsedExtensionSessionTransportRequest,
  StorageProvider,
}
