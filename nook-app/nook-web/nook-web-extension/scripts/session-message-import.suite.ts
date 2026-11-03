import { err, ok } from 'neverthrow'
import { describe, expect, test } from 'bun:test'
import {
  SessionOperationFailure,
  SessionOperationFailureKind,
} from '../src/lib/session-operation-queue'
import {
  BrowserRuntimeMessage,
  BrowserRuntimeMessageAdmissionKind,
  ExtensionSessionMessageDispatcher,
  ExtensionSessionMessageType,
  ExtensionSessionRequestParseKind,
  MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
  decodeProviders,
  parseExtensionSessionRequest,
  sessionMessageWireFixture,
  vaultImportRequest,
  type StorageProvider,
} from './session-message-dispatch-test-support'
import type { BrowserRuntimeMessageValue } from '../src/lib/browser-runtime-message'
import { ProviderRowFixture, type ProviderRows } from './provider-row-fixture'

/** A raw vault import as the offscreen session receives it. */
class RawVaultImport {
  readonly payload: {
    readonly [key: string]: BrowserRuntimeMessageValue
  }

  constructor(providers: BrowserRuntimeMessageValue[]) {
    this.payload = {
      vaultStoreId: 'store_abcdefghijk',
      deviceId: 'device',
      devicePublicKey: 'public',
      deviceSigningPublicKey: 'signing',
      providers,
      eventLogRecords: [],
      queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
    }
  }

  parse() {
    return parseExtensionSessionRequest({
      type: ExtensionSessionMessageType.ImportVault,
      payload: this.payload,
    })
  }
}

/** One raw row with a damage the Rust decoder must refuse. */
class DamagedRows {
  static withoutProvider(): BrowserRuntimeMessageValue {
    const row = ProviderRowFixture.github(ProviderRowFixture.SEALED)
    Reflect.deleteProperty(row, 'provider')
    return row
  }

  static githubWithoutToken(): BrowserRuntimeMessageValue {
    const row = ProviderRowFixture.github(ProviderRowFixture.SEALED)
    Reflect.deleteProperty(row.provider, 'token')
    return row
  }

  static githubWithS3Secret(): BrowserRuntimeMessageValue {
    const row = ProviderRowFixture.github(ProviderRowFixture.SEALED)
    Reflect.set(row.provider, 'secretAccessKey', ProviderRowFixture.SEALED)
    return row
  }

  static localWithToken(): BrowserRuntimeMessageValue {
    const row = ProviderRowFixture.local()
    Reflect.set(row.provider, 'token', ProviderRowFixture.SEALED)
    return row
  }

  static unknownType(): BrowserRuntimeMessageValue {
    const row = ProviderRowFixture.github(ProviderRowFixture.SEALED)
    Reflect.set(row.provider, 'type', 'ftp')
    return row
  }

  /** The row shape before the tagged provider: no reader accepts it. */
  static flatLegacy(): BrowserRuntimeMessageValue {
    return {
      id: 'github',
      type: 'github',
      label: 'GitHub',
      githubPat: { state: 'token', value: ProviderRowFixture.SEALED },
      githubRepo: { state: 'defaultRepository' },
      storeId: { state: 'unscoped' },
      syncCheckpoint: { state: 'neverSynced' },
      createdAt: ProviderRowFixture.CREATED_AT,
    }
  }

  static plaintextToken(): BrowserRuntimeMessageValue {
    return ProviderRowFixture.github(ProviderRowFixture.PLAINTEXT)
  }
}

describe('ExtensionSessionMessageDispatcher vault import', () => {
  test('empties the caller’s raw rows before awaiting cold WASM', async () => {
    const providers: BrowserRuntimeMessageValue[] = ProviderRowFixture.every(
      ProviderRowFixture.SEALED,
    )
    const message = new RawVaultImport(providers)
    const parsing = message.parse()

    expect(providers).toEqual([{}, {}, {}, {}, {}, {}])
    expect(message.payload.providers).toEqual([])
    const parsed = await parsing
    expect(parsed.kind).toBe(ExtensionSessionRequestParseKind.Parsed)
    if (parsed.kind !== ExtensionSessionRequestParseKind.Parsed) return
    // The staged request keeps every row whole for the import itself.
    expect(sessionMessageWireFixture.providers(parsed.request)).toEqual(
      ProviderRowFixture.every(ProviderRowFixture.SEALED),
    )
  })

  test('refuses damaged raw rows and still empties every one', async () => {
    const providers: BrowserRuntimeMessageValue[] = [
      'not-a-row',
      7,
      { provider: 'malformed' },
      DamagedRows.flatLegacy(),
      ProviderRowFixture.github(ProviderRowFixture.SEALED),
    ]
    const parsed = await new RawVaultImport(providers).parse()

    expect(parsed.kind).toBe(ExtensionSessionRequestParseKind.Invalid)
    expect(providers).toEqual(['not-a-row', 7, {}, {}, {}])
  })

  test('refuses each incomplete, mixed or unsealed row, as Rust does', async () => {
    for (const row of [
      DamagedRows.withoutProvider(),
      DamagedRows.githubWithoutToken(),
      DamagedRows.githubWithS3Secret(),
      DamagedRows.localWithToken(),
      DamagedRows.unknownType(),
      DamagedRows.flatLegacy(),
      DamagedRows.plaintextToken(),
    ]) {
      const parsed = await new RawVaultImport([row]).parse()
      expect(parsed.kind).toBe(ExtensionSessionRequestParseKind.Invalid)
    }
  })

  test('rejects non-serialized providers before dispatching a vault import', async () => {
    const row = ProviderRowFixture.github(ProviderRowFixture.PLAINTEXT)
    const admission = BrowserRuntimeMessage.from({
      type: ExtensionSessionMessageType.ImportVault,
      payload: {
        providers: [{ ...row, metadata: new Date() }],
        queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
      },
    })

    expect(admission.kind).toBe(BrowserRuntimeMessageAdmissionKind.Rejected)
    expect(row).toEqual(ProviderRowFixture.github(ProviderRowFixture.PLAINTEXT))
  })

  test('rejects a vault import without a provider array', async () => {
    const response = await parseExtensionSessionRequest({
      type: ExtensionSessionMessageType.ImportVault,
      payload: {
        providers: 'missing-array',
        queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
      },
    })

    expect(response.kind).toBe(ExtensionSessionRequestParseKind.Invalid)
  })

  test('wipes an accepted caller provider array after staging', async () => {
    const providers = [ProviderRowFixture.github(ProviderRowFixture.PLAINTEXT)]
    let handled: ProviderRows = []
    const dispatcher = new ExtensionSessionMessageDispatcher({
      decodeProviders,
      handleMessage: async (message) => {
        if (message.type === ExtensionSessionMessageType.ImportVault) {
          handled = structuredClone(
            sessionMessageWireFixture.providers(message),
          )
        }
        return ok({ ok: true })
      },
    })

    const request = vaultImportRequest(providers)
    const response = dispatcher.enqueue(request)

    expect(request.payload.providers).toEqual([])
    expect(providers).toEqual(
      ProviderRowFixture.afterWipe([
        ProviderRowFixture.github(ProviderRowFixture.OTHER),
      ]),
    )
    expect(await response).toEqual(ok({ ok: true }))
    expect(handled).toEqual([
      ProviderRowFixture.github(ProviderRowFixture.PLAINTEXT),
    ])
  })

  test('reserves import ordering before provider decoding completes', async () => {
    let finishDecode: (providers: StorageProvider[]) => void = () => {
      throw new Error('provider decoder was not initialized')
    }
    const decodedProviders = new Promise<StorageProvider[]>((resolve) => {
      finishDecode = resolve
    })
    const handledTypes: string[] = []
    const dispatcher = new ExtensionSessionMessageDispatcher({
      decodeProviders: () => decodedProviders,
      handleMessage: async (message) => {
        const type =
          message && typeof message === 'object' && 'type' in message
            ? String(message.type)
            : ''
        handledTypes.push(type)
        if (type === ExtensionSessionMessageType.Reset) {
          dispatcher.replaceOperations(
            new SessionOperationFailure(SessionOperationFailureKind.Closed),
          )
        }
        return ok({ ok: true })
      },
    })

    const importResponse = dispatcher.enqueue(vaultImportRequest([]))
    const resetResponse = dispatcher.enqueue({
      type: ExtensionSessionMessageType.Reset,
      payload: { queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE },
    })
    await Promise.resolve()
    expect(handledTypes).toEqual([])

    finishDecode([])
    expect(await importResponse).toEqual(ok({ ok: true }))
    expect(await resetResponse).toEqual(ok({ ok: true }))
    expect(handledTypes).toEqual([
      ExtensionSessionMessageType.ImportVault,
      ExtensionSessionMessageType.Reset,
    ])
  })

  test('wipes decoded provider credentials when a pending import is canceled', async () => {
    let finishDecode: (providers: StorageProvider[]) => void = () => {
      throw new Error('provider decoder was not initialized')
    }
    let releaseBlocker: () => void = () => {
      throw new Error('queue blocker was not initialized')
    }
    const decodedProviders = new Promise<StorageProvider[]>((resolve) => {
      finishDecode = resolve
    })
    const blocker = new Promise<void>((resolve) => {
      releaseBlocker = resolve
    })
    const stagedProviders = [
      ProviderRowFixture.github(ProviderRowFixture.PLAINTEXT),
    ]
    const dispatcher = new ExtensionSessionMessageDispatcher({
      decodeProviders: () => decodedProviders,
      handleMessage: async (message) => {
        const type =
          message && typeof message === 'object' && 'type' in message
            ? String(message.type)
            : ''
        if (type === ExtensionSessionMessageType.CreatePin) await blocker
        return ok({ ok: true })
      },
    })

    const blockerResponse = dispatcher.enqueue({
      type: ExtensionSessionMessageType.CreatePin,
      payload: {
        pin: '123456',
        queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
      },
    })
    const importResponse = dispatcher.enqueue(
      vaultImportRequest([
        ProviderRowFixture.github(ProviderRowFixture.SEALED),
      ]),
    )

    dispatcher.replaceOperations(
      new SessionOperationFailure(SessionOperationFailureKind.Closed),
    )
    finishDecode(stagedProviders)
    expect(await importResponse).toEqual(
      err(new SessionOperationFailure(SessionOperationFailureKind.Closed)),
    )
    await decodedProviders
    await Promise.resolve()
    expect(stagedProviders).toEqual(
      ProviderRowFixture.afterWipe([
        ProviderRowFixture.github(ProviderRowFixture.OTHER),
      ]),
    )

    releaseBlocker()
    expect(await blockerResponse).toEqual(ok({ ok: true }))
  })

  test('honors a vault-import deadline and wipes expired staging', async () => {
    let releaseBlocker: () => void = () => {
      throw new Error('queue blocker was not initialized')
    }
    const blocker = new Promise<void>((resolve) => {
      releaseBlocker = resolve
    })
    const stagedProviders = [
      ProviderRowFixture.github(ProviderRowFixture.PLAINTEXT),
    ]
    const handledTypes: string[] = []
    const dispatcher = new ExtensionSessionMessageDispatcher({
      decodeProviders: async () => stagedProviders,
      handleMessage: async (message) => {
        handledTypes.push(message.type)
        if (message.type === ExtensionSessionMessageType.CreatePin) {
          await blocker
        }
        return ok({ ok: true })
      },
    })

    const blockerResponse = dispatcher.enqueue({
      type: ExtensionSessionMessageType.CreatePin,
      payload: {
        pin: '123456',
        queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
      },
    })
    const importResponse = dispatcher.enqueue(
      vaultImportRequest(
        [ProviderRowFixture.github(ProviderRowFixture.SEALED)],
        {
          kind: 'deadline',
          expiresAt: Date.now() + 10,
          priority: 'interactive',
        },
      ),
    )
    const importSettlement = importResponse

    await Bun.sleep(20)
    releaseBlocker()
    expect(await blockerResponse).toEqual(ok({ ok: true }))
    expect(await importSettlement).toEqual(
      err(new SessionOperationFailure(SessionOperationFailureKind.Expired)),
    )
    await Promise.resolve()
    expect(handledTypes).toEqual([ExtensionSessionMessageType.CreatePin])
    expect(stagedProviders).toEqual(
      ProviderRowFixture.afterWipe([
        ProviderRowFixture.github(ProviderRowFixture.OTHER),
      ]),
    )
  })
})
