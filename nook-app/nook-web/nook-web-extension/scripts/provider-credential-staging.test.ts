import { err } from 'neverthrow'
import { beforeAll, describe, expect, test } from 'bun:test'
import {
  ProviderCredentialFailure,
  ProviderCredentialBuffer,
} from '../src/lib/provider-credential-staging'
import initNookWasm, {
  admit_extension_storage_providers,
  type StorageProvider,
} from '../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import { ExtensionSessionMessageType } from '../src/lib/extension-session-message-type'
import {
  ExtensionSessionRequestParseKind,
  MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
  parseExtensionSessionRequest,
} from '../src/offscreen/session-request-adapter'

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

class ProviderStagingFixture {
  github(): StorageProvider {
    return {
      id: 'github',
      type: 'github',
      label: 'GitHub',
      githubPat: { state: 'token', value: 'github_pat_secret' },
      githubRepo: { state: 'defaultRepository' },
      oauthFile: { state: 'notApplicable' },
      localFolder: { state: 'notApplicable' },
      storeId: { state: 'unscoped' },
      syncCheckpoint: { state: 'neverSynced' },
      createdAt: '2026-06-24T00:00:00.000Z',
    }
  }
  async stage(
    providers: ConstructorParameters<typeof ProviderCredentialBuffer>[0],
  ) {
    return new ProviderCredentialBuffer(providers).stage({
      decode: async (candidate) => admit_extension_storage_providers(candidate),
    })
  }
}

const providerStagingFixture = new ProviderStagingFixture()

function parseProviderImport(providers: unknown[]) {
  return parseExtensionSessionRequest({
    type: ExtensionSessionMessageType.ImportVault,
    payload: {
      vaultStoreId: 'vault',
      deviceId: 'device',
      devicePublicKey: 'public',
      deviceSigningPublicKey: 'signing',
      providers,
      eventLogRecords: [],
      queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
    },
  })
}

describe('provider credential staging', () => {
  test('invalid identity is a typed rejection', () => {
    expect(
      new ProviderCredentialBuffer([{ id: '', type: 'github' }]).identities(),
    ).toEqual(err(ProviderCredentialFailure.InvalidIdentity))
  })

  test('foreign admission rejection erases the staged credential copy', async () => {
    const source = [providerStagingFixture.github()]
    let staged: unknown[] = []
    const result = await new ProviderCredentialBuffer(source).stage({
      decode: async (candidate) => {
        staged = candidate
        return Promise.reject('foreign admission rejected')
      },
    })
    expect(result).toEqual(err(ProviderCredentialFailure.AdmissionRejected))
    expect(staged).toEqual([{ ...source[0], githubPat: { state: 'missing' } }])
    expect(source[0]?.githubPat).toEqual({
      state: 'token',
      value: 'github_pat_secret',
    })
  })

  test('copies complete providers through canonical admission', async () => {
    const source = [providerStagingFixture.github()]
    const staging = await providerStagingFixture.stage(source)
    expect(staging.isOk()).toBe(true)
    if (staging.isErr()) return
    expect(staging.value).toEqual(source)
    expect(staging.value[0]).not.toBe(source[0])
    expect(source[0]?.githubPat).toEqual({
      state: 'token',
      value: 'github_pat_secret',
    })
  })

  test('scrubs decoded providers when queued import work expires', async () => {
    const staging = await providerStagingFixture.stage([
      providerStagingFixture.github(),
    ])
    expect(staging.isOk()).toBe(true)
    if (staging.isErr()) return
    new ProviderCredentialBuffer(staging.value).clear()
    expect(staging.value[0]?.githubPat).toEqual({ state: 'missing' })
  })

  test('scrubs a raw IPC snapshot after successful handoff', async () => {
    const providers = [providerStagingFixture.github()]
    let observedDuringHandoff = false
    await expect(
      new ProviderCredentialBuffer(providers).runWithCleanup(async () => {
        observedDuringHandoff = providers[0]?.githubPat.state === 'token'
        return { ok: true }
      }),
    ).resolves.toEqual({ ok: true })
    expect(observedDuringHandoff).toBe(true)
    expect(providers[0]?.githubPat).toEqual({ state: 'missing' })
  })

  test('scrubs a raw IPC snapshot after failed handoff', async () => {
    const providers = [providerStagingFixture.github()]
    await expect(
      new ProviderCredentialBuffer(providers).runWithCleanup(async () => {
        return err(ProviderCredentialFailure.AdmissionRejected)
      }),
    ).resolves.toEqual(err(ProviderCredentialFailure.AdmissionRejected))
    expect(providers[0]?.githubPat).toEqual({ state: 'missing' })
  })

  test('continues scrubbing after malformed OAuth transport', async () => {
    const providers = [
      { oauthFile: 'malformed' },
      { oauthFile: { config: 'malformed' } },
      { githubPat: 'github_pat_following_secret' },
    ]
    expect((await parseProviderImport(providers)).kind).toBe(
      ExtensionSessionRequestParseKind.Invalid,
    )
    expect(providers[2]).toHaveProperty('githubPat.state', 'missing')
  })

  test('rejects values outside serialized external data', async () => {
    const source = [
      { ...providerStagingFixture.github(), metadata: new Date() },
    ]
    await expect(providerStagingFixture.stage(source)).resolves.toEqual(
      err(ProviderCredentialFailure.InvalidTransport),
    )
    expect(source[0]?.githubPat).toEqual({ state: 'missing' })
  })

  test('preserves valid identity-only metadata for canonical provider admission', async () => {
    const providerIdentity = { id: 'github', type: 'github' }
    const parsed = await parseProviderImport([providerIdentity])
    expect(parsed.kind).toBe(ExtensionSessionRequestParseKind.Parsed)
    if (parsed.kind !== ExtensionSessionRequestParseKind.Parsed) return
    expect(parsed.request.type).toBe(ExtensionSessionMessageType.ImportVault)
    if (parsed.request.type !== ExtensionSessionMessageType.ImportVault) return
    expect(parsed.request.payload.providers).toEqual([providerIdentity])
  })

  test('canonical admission does not retain prototype metadata', async () => {
    const source = providerStagingFixture.github()
    Object.defineProperty(source, '__proto__', {
      value: { githubPat: 'inherited-secret' },
      enumerable: true,
    })
    const staging = await providerStagingFixture.stage([source])
    expect(staging.isOk()).toBe(true)
    if (staging.isErr()) return
    expect(Object.hasOwn(staging.value[0] || {}, '__proto__')).toBe(false)
  })
})
