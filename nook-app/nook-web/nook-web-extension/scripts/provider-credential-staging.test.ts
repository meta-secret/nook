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
  async stage(providers: unknown[]) {
    return new ProviderCredentialBuffer(providers).stage({
      decode: async (candidate) => admit_extension_storage_providers(candidate),
    })
  }
}

const providerStagingFixture = new ProviderStagingFixture()

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
    const providers = [{ githubPat: 'github_pat_snapshot_secret' }]
    let observedDuringHandoff = ''
    await expect(
      new ProviderCredentialBuffer(providers).runWithCleanup(async () => {
        observedDuringHandoff = providers[0]?.githubPat || ''
        return { ok: true }
      }),
    ).resolves.toEqual({ ok: true })
    expect(observedDuringHandoff).toBe('github_pat_snapshot_secret')
    expect(providers[0]).not.toHaveProperty('githubPat')
  })

  test('scrubs a raw IPC snapshot after failed handoff', async () => {
    const providers = [{ githubPat: 'github_pat_failed_snapshot' }]
    await expect(
      new ProviderCredentialBuffer(providers).runWithCleanup(async () => {
        return err(ProviderCredentialFailure.AdmissionRejected)
      }),
    ).resolves.toEqual(err(ProviderCredentialFailure.AdmissionRejected))
    expect(providers[0]).not.toHaveProperty('githubPat')
  })

  test('continues scrubbing after malformed OAuth transport', () => {
    const providers = [
      { oauthFile: 'malformed' },
      { oauthFile: { config: 'malformed' } },
      { githubPat: 'github_pat_following_secret' },
    ]
    new ProviderCredentialBuffer(providers).clear()
    expect(providers[2]).not.toHaveProperty('githubPat')
  })

  test('rejects values outside serialized external data', async () => {
    const source = [
      { ...providerStagingFixture.github(), metadata: new Date() },
    ]
    expect(await providerStagingFixture.stage(source)).toEqual(
      err(ProviderCredentialFailure.InvalidTransport),
    )
    new ProviderCredentialBuffer(source).clear()
    expect(source[0]?.githubPat).toEqual({ state: 'missing' })
  })

  test('identity-only metadata cannot become a stored provider', async () => {
    expect(
      await providerStagingFixture.stage([{ id: 'github', type: 'github' }]),
    ).toEqual(err(ProviderCredentialFailure.AdmissionRejected))
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
