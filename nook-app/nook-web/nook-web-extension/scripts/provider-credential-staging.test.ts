import { err, ok } from 'neverthrow'
import { beforeAll, describe, expect, test } from 'bun:test'
import {
  ProviderCredentialFailure,
  ProviderCredentialBuffer,
} from '../src/lib/provider-credential-staging'
import initNookWasm, {
  admit_extension_storage_providers,
  decode_extension_pairing_storage_provider,
  seal_auth_providers_for_device_public_key,
  type AuthProvidersSnapshot,
  type StorageProvider,
} from '../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import { ExtensionSessionMessageType } from '../src/lib/extension-session-message-type'
import {
  BrowserRuntimeMessage,
  BrowserRuntimeMessageAdmissionKind,
} from '../src/lib/browser-runtime-message'
import {
  ExtensionSessionRequestParseKind,
  MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
  parseExtensionSessionRequest,
} from '../src/offscreen/session-request-adapter'
import { ProviderRowFixture, type ProviderRows } from './provider-row-fixture'

beforeAll(async () => {
  await initNookWasm({
    module_or_path: await Bun.file(
      new URL(
        '../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm_bg.wasm',
        import.meta.url,
      ),
    ).arrayBuffer(),
  })
})

/** Rust's own credential walk, reached through the export that seals every
 * credential a row holds for another app. */
class RustCredentialWalk {
  sealed(row: StorageProvider): ProviderRows {
    const snapshot: AuthProvidersSnapshot = {
      providers: [row],
      activeVaultStoreId: { state: 'unselected' },
    }
    return seal_auth_providers_for_device_public_key(
      ProviderRowFixture.SEALING_RECIPIENT,
      snapshot,
    ).providers
  }
}

const rustWalk = new RustCredentialWalk()

/** The four stored variants that hold a credential. */
class CredentialRows {
  static every(credential: string): ProviderRows {
    return [
      ProviderRowFixture.github(credential),
      ProviderRowFixture.googleDrive(credential),
      ProviderRowFixture.icloud(credential),
      ProviderRowFixture.s3(credential),
    ]
  }
}

describe('the provider credential wipe', () => {
  test('drops every credential Rust seals, for every variant', () => {
    for (const row of ProviderRowFixture.every(ProviderRowFixture.PLAINTEXT)) {
      const sealed = rustWalk.sealed(row)
      const canonical = admit_extension_storage_providers([row])
      expect(ProviderRowFixture.afterWipe(sealed)).toEqual(
        ProviderRowFixture.afterWipe(canonical),
      )
    }
  })

  test('the cross-check sees each credential Rust seals', () => {
    for (const row of CredentialRows.every(ProviderRowFixture.PLAINTEXT)) {
      expect(rustWalk.sealed(row)).not.toEqual([row])
    }
  })

  test('leaves no credential text, whatever it was', () => {
    expect(ProviderRowFixture.every(ProviderRowFixture.PLAINTEXT)).not.toEqual(
      ProviderRowFixture.every(ProviderRowFixture.SEALED),
    )
    expect(
      ProviderRowFixture.afterWipe(
        ProviderRowFixture.every(ProviderRowFixture.PLAINTEXT),
      ),
    ).toEqual(
      ProviderRowFixture.afterWipe(
        ProviderRowFixture.every(ProviderRowFixture.SEALED),
      ),
    )
  })

  test('leaves this browser’s store and a local folder as they are', () => {
    expect(
      ProviderRowFixture.afterWipe([
        ProviderRowFixture.local(),
        ProviderRowFixture.localFolder(),
      ]),
    ).toEqual([ProviderRowFixture.local(), ProviderRowFixture.localFolder()])
  })

  test('a wiped row can never be admitted again', () => {
    for (const row of ProviderRowFixture.afterWipe(
      CredentialRows.every(ProviderRowFixture.PLAINTEXT),
    )) {
      expect(() => admit_extension_storage_providers([row])).toThrow()
    }
  })
})

describe('provider rows through the generated package', () => {
  test('every variant reads back from Rust unchanged', () => {
    for (const credential of [
      ProviderRowFixture.SEALED,
      ProviderRowFixture.PLAINTEXT,
    ]) {
      expect(
        admit_extension_storage_providers(ProviderRowFixture.every(credential)),
      ).toEqual(ProviderRowFixture.every(credential))
    }
  })

  test('the pairing decoder admits sealed rows and refuses plaintext ones', () => {
    for (const row of ProviderRowFixture.every(ProviderRowFixture.SEALED)) {
      expect(decode_extension_pairing_storage_provider(row)).toEqual(row)
    }
    for (const row of CredentialRows.every(ProviderRowFixture.PLAINTEXT)) {
      expect(() => decode_extension_pairing_storage_provider(row)).toThrow(
        'not storage-safe',
      )
    }
  })
})

describe('provider credential staging', () => {
  test('copies every variant through canonical admission and wipes the staged copy', async () => {
    const source = ProviderRowFixture.every(ProviderRowFixture.SEALED)
    let staged: ProviderRows = []
    const staging = await new ProviderCredentialBuffer(source).stage({
      decode: async (candidate) => {
        staged = candidate
        return admit_extension_storage_providers(candidate)
      },
    })
    expect(staging).toEqual(
      ok(ProviderRowFixture.every(ProviderRowFixture.SEALED)),
    )
    expect(staged).toEqual(
      ProviderRowFixture.afterWipe(
        ProviderRowFixture.every(ProviderRowFixture.OTHER),
      ),
    )
    expect(source).toEqual(ProviderRowFixture.every(ProviderRowFixture.SEALED))
  })

  test('a refused admission wipes the staged copy', async () => {
    const source = ProviderRowFixture.every(ProviderRowFixture.SEALED)
    let staged: ProviderRows = []
    const result = await new ProviderCredentialBuffer(source).stage({
      decode: async (candidate) => {
        staged = candidate
        return Promise.reject(new Error('foreign admission rejected'))
      },
    })
    expect(result).toEqual(err(ProviderCredentialFailure.AdmissionRejected))
    expect(staged).toEqual(
      ProviderRowFixture.afterWipe(
        ProviderRowFixture.every(ProviderRowFixture.OTHER),
      ),
    )
    expect(source).toEqual(ProviderRowFixture.every(ProviderRowFixture.SEALED))
  })

  test('a value outside serialized data is an invalid transport', async () => {
    const row = ProviderRowFixture.github(ProviderRowFixture.SEALED)
    Reflect.set(row, 'label', () => 'not serialized')
    let decoded = false
    const result = await new ProviderCredentialBuffer([row]).stage({
      decode: async (candidate) => {
        decoded = true
        return candidate
      },
    })
    expect(result).toEqual(err(ProviderCredentialFailure.InvalidTransport))
    expect(decoded).toBe(false)
    expect(row.provider).toEqual(
      ProviderRowFixture.github(ProviderRowFixture.SEALED).provider,
    )
  })

  test('canonical admission does not retain prototype metadata', async () => {
    const source = ProviderRowFixture.github(ProviderRowFixture.SEALED)
    Object.defineProperty(source, '__proto__', {
      value: { token: 'inherited-secret' },
      enumerable: true,
    })
    const staging = await new ProviderCredentialBuffer([source]).stage({
      decode: async (candidate) => admit_extension_storage_providers(candidate),
    })
    expect(
      staging._unsafeUnwrap().filter((row) => Object.hasOwn(row, '__proto__')),
    ).toEqual([])
  })

  test('wipes the rows after a successful handoff', async () => {
    const rows = ProviderRowFixture.every(ProviderRowFixture.PLAINTEXT)
    let during: ProviderRows = []
    expect(
      await new ProviderCredentialBuffer(rows).runWithCleanup(async () => {
        during = structuredClone(rows)
        return { ok: true }
      }),
    ).toEqual({ ok: true })
    expect(during).toEqual(
      ProviderRowFixture.every(ProviderRowFixture.PLAINTEXT),
    )
    expect(rows).toEqual(
      ProviderRowFixture.afterWipe(
        ProviderRowFixture.every(ProviderRowFixture.OTHER),
      ),
    )
  })

  test('wipes the rows after a failed handoff', async () => {
    const rows = ProviderRowFixture.every(ProviderRowFixture.PLAINTEXT)
    expect(
      await new ProviderCredentialBuffer(rows).runWithCleanup(async () =>
        err(ProviderCredentialFailure.AdmissionRejected),
      ),
    ).toEqual(err(ProviderCredentialFailure.AdmissionRejected))
    expect(rows).toEqual(
      ProviderRowFixture.afterWipe(
        ProviderRowFixture.every(ProviderRowFixture.OTHER),
      ),
    )
  })

  test('names each row to the companion protocol by id and provider type', () => {
    expect(
      new ProviderCredentialBuffer(
        ProviderRowFixture.every(ProviderRowFixture.SEALED),
      ).identities(),
    ).toEqual([
      { id: 'local', type: 'local' },
      { id: 'local-folder', type: 'local-folder' },
      { id: 'github', type: 'github' },
      { id: 'google-drive', type: 'oauth-file' },
      { id: 'icloud', type: 'oauth-file' },
      { id: 's3', type: 's3' },
    ])
  })

  test('rejects values outside serialized external data before dispatch', () => {
    const row = ProviderRowFixture.github(ProviderRowFixture.SEALED)
    const admission = BrowserRuntimeMessage.from({
      type: ExtensionSessionMessageType.ImportVault,
      payload: {
        providers: [{ ...row, metadata: new Date() }],
        queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
      },
    })
    expect(admission.kind).toBe(BrowserRuntimeMessageAdmissionKind.Rejected)
    expect(row).toEqual(ProviderRowFixture.github(ProviderRowFixture.SEALED))
  })

  test('parses every sealed variant from an import and keeps each row whole', async () => {
    const parsed = await parseExtensionSessionRequest({
      type: ExtensionSessionMessageType.ImportVault,
      payload: {
        vaultStoreId: 'store_abcdefghijk',
        deviceId: 'device',
        devicePublicKey: 'public',
        deviceSigningPublicKey: 'signing',
        providers: ProviderRowFixture.every(ProviderRowFixture.SEALED),
        eventLogRecords: [],
        queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
      },
    })
    expect(parsed.kind).toBe(ExtensionSessionRequestParseKind.Parsed)
    if (parsed.kind !== ExtensionSessionRequestParseKind.Parsed) return
    if (parsed.request.type !== ExtensionSessionMessageType.ImportVault) return
    expect(parsed.request.payload.providers).toEqual(
      ProviderRowFixture.every(ProviderRowFixture.SEALED),
    )
  })
})
