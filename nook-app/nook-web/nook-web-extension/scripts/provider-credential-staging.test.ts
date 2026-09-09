import { beforeAll, describe, expect, test } from 'bun:test'
import {
  ProviderCredentialStagingKind,
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
  static github(): StorageProvider {
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
  static async stage(providers: unknown[]) {
    return ProviderCredentialBuffer.stage({
      providers,
      decode: async (candidate) => admit_extension_storage_providers(candidate),
    })
  }
}

describe('provider credential staging', () => {
  test('copies complete providers through canonical admission', async () => {
    const source = [ProviderStagingFixture.github()]
    const staging = await ProviderStagingFixture.stage(source)
    expect(staging.kind).toBe(ProviderCredentialStagingKind.Staged)
    if (staging.kind !== ProviderCredentialStagingKind.Staged) return
    expect(staging.providers).toEqual(source)
    expect(staging.providers[0]).not.toBe(source[0])
    expect(source[0]?.githubPat).toEqual({
      state: 'token',
      value: 'github_pat_secret',
    })
  })

  test('scrubs decoded providers when queued import work expires', async () => {
    const staging = await ProviderStagingFixture.stage([
      ProviderStagingFixture.github(),
    ])
    expect(staging.kind).toBe(ProviderCredentialStagingKind.Staged)
    if (staging.kind !== ProviderCredentialStagingKind.Staged) return
    new ProviderCredentialBuffer(staging.providers).clear()
    expect(staging.providers[0]?.githubPat).toEqual({ state: 'missing' })
  })

  test('scrubs a raw IPC snapshot after successful handoff', async () => {
    const providers = [{ githubPat: 'github_pat_snapshot_secret' }]
    let observedDuringHandoff = ''
    await expect(
      ProviderCredentialBuffer.runWithCleanup({
        providers,
        operation: async () => {
          observedDuringHandoff = providers[0]?.githubPat || ''
          return { ok: true }
        },
      }),
    ).resolves.toEqual({ ok: true })
    expect(observedDuringHandoff).toBe('github_pat_snapshot_secret')
    expect(providers[0]).not.toHaveProperty('githubPat')
  })

  test('scrubs a raw IPC snapshot after failed handoff', async () => {
    const providers = [{ githubPat: 'github_pat_failed_snapshot' }]
    await expect(
      ProviderCredentialBuffer.runWithCleanup({
        providers,
        operation: async () => {
          throw new Error('handoff failed')
        },
      }),
    ).rejects.toThrow('handoff failed')
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
      { ...ProviderStagingFixture.github(), metadata: new Date() },
    ]
    expect((await ProviderStagingFixture.stage(source)).kind).toBe(
      ProviderCredentialStagingKind.InvalidInput,
    )
    new ProviderCredentialBuffer(source).clear()
    expect(source[0]?.githubPat).toEqual({ state: 'missing' })
  })

  test('identity-only metadata cannot become a stored provider', async () => {
    expect(
      (await ProviderStagingFixture.stage([{ id: 'github', type: 'github' }]))
        .kind,
    ).toBe(ProviderCredentialStagingKind.InvalidInput)
  })

  test('canonical admission does not retain prototype metadata', async () => {
    const source = ProviderStagingFixture.github()
    Object.defineProperty(source, '__proto__', {
      value: { githubPat: 'inherited-secret' },
      enumerable: true,
    })
    const staging = await ProviderStagingFixture.stage([source])
    expect(staging.kind).toBe(ProviderCredentialStagingKind.Staged)
    if (staging.kind !== ProviderCredentialStagingKind.Staged) return
    expect(Object.hasOwn(staging.providers[0] || {}, '__proto__')).toBe(false)
  })
})
