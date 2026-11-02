import { describe, expect, test, vi } from 'vitest'
import {
  apply_provider_save_policy,
  draft_storage_args,
  existing_provider_save_setup,
  github_provider_draft,
  NookProviderSaveOutcomeState,
  NookStagedStorageArgsState,
  new_provider_save_setup,
  provider_kind_replication_capability,
  put_provider_sign_in,
  ReplicationSupport,
  ReplicationType,
  staged_storage_args,
  type AuthProvidersSnapshot,
  type ProviderDraft,
  type ProviderSaveRequest,
} from '$app-wasm'
import { ProviderSetupKinds } from '$lib/vault/provider-setup-kinds'
import {
  ProviderDraftFixture,
  ProviderFixtureCredentials,
  ProviderRowFixture,
} from '../provider-fixtures'

/** One row of every stored variant, in one snapshot. */
class ProviderAbiFixture {
  static snapshot(): AuthProvidersSnapshot {
    return {
      providers: [
        ProviderRowFixture.local(ProviderRowFixture.unscoped('local')),
        ProviderRowFixture.localFolder(ProviderRowFixture.unscoped('folder')),
        ProviderRowFixture.github(ProviderRowFixture.unscoped('github')),
        ProviderRowFixture.googleDrive(ProviderRowFixture.unscoped('drive')),
        ProviderRowFixture.icloud(ProviderRowFixture.unscoped('icloud')),
        ProviderRowFixture.s3(ProviderRowFixture.unscoped('s3')),
      ],
      activeVaultStoreId: { state: 'unselected' },
    }
  }

  static newSave(draft: ProviderDraft): ProviderSaveRequest {
    return {
      snapshot: { providers: [], activeVaultStoreId: { state: 'unselected' } },
      providerStoreId: { state: 'unscoped' },
      setup: new_provider_save_setup(),
      duplicates: 'reject',
      draft,
      newProviderId: 'github-new',
      createdAt: '2026-01-02T00:00:00.000Z',
    }
  }
}

describe('provider draft generated-package ABI', () => {
  test('carries every tagged row through the save policy unchanged and frees the outcome once', () => {
    const snapshot = ProviderAbiFixture.snapshot()
    const outcome = apply_provider_save_policy({
      snapshot,
      providerStoreId: { state: 'unscoped' },
      setup: existing_provider_save_setup(),
      duplicates: 'keepExisting',
      draft: ProviderDraftFixture.thisBrowser(),
      newProviderId: 'unused',
      createdAt: '2026-01-02T00:00:00.000Z',
    })
    const free = vi.spyOn(outcome, 'free')
    expect(outcome.state).toBe(NookProviderSaveOutcomeState.Saved)
    expect(outcome.snapshot.providers).toEqual(snapshot.providers)
    outcome.free()
    expect(free).toHaveBeenCalledTimes(1)
  })

  test('saves a new GitHub draft as a tagged row and hands back its draft', () => {
    const draft = github_provider_draft({
      token: ProviderFixtureCredentials.GITHUB_TOKEN,
      repository: 'nook',
    })
    const outcome = apply_provider_save_policy(
      ProviderAbiFixture.newSave(draft),
    )
    try {
      expect(outcome.state).toBe(NookProviderSaveOutcomeState.Saved)
      expect(outcome.snapshot.providers.map((row) => row.provider)).toEqual([
        {
          type: 'github',
          repository: { state: 'repository', value: 'nook' },
          token: ProviderFixtureCredentials.GITHUB_TOKEN,
        },
      ])
      expect(outcome.draft).toEqual(draft)
    } finally {
      outcome.free()
    }
  })

  test('a draft awaiting its token names the gap instead of saving', () => {
    const outcome = apply_provider_save_policy(
      ProviderAbiFixture.newSave(ProviderDraftFixture.githubAwaitingToken()),
    )
    try {
      expect(outcome.state).toBe(NookProviderSaveOutcomeState.Incomplete)
      expect(outcome.gap).toBe('githubToken')
    } finally {
      outcome.free()
    }
  })

  test('an explicit add of a saved provider is a duplicate', () => {
    const draft = ProviderDraftFixture.githubEntered()
    const first = apply_provider_save_policy(ProviderAbiFixture.newSave(draft))
    const saved = first.snapshot
    first.free()
    const again = apply_provider_save_policy({
      ...ProviderAbiFixture.newSave(draft),
      snapshot: saved,
    })
    try {
      expect(again.state).toBe(NookProviderSaveOutcomeState.Duplicate)
    } finally {
      again.free()
    }
  })

  test('a draft connects once complete and names its gap before', () => {
    expect(draft_storage_args(ProviderDraftFixture.githubEntered())).toEqual({
      state: 'ready',
      connection: {
        mode: 'github',
        token: ProviderFixtureCredentials.GITHUB_TOKEN,
        repo: 'nook',
      },
    })
    expect(
      draft_storage_args(ProviderDraftFixture.githubAwaitingToken()),
    ).toEqual({ state: 'incomplete', gap: 'githubToken' })
  })

  test("a refreshed sign-in reaches every saved row of the draft's folder", () => {
    const snapshot = ProviderAbiFixture.snapshot()
    const updated = put_provider_sign_in({
      snapshot,
      draft: ProviderDraftFixture.googleDriveConnected(),
    })
    const drive = updated.providers.find((row) => row.id === 'drive')
    expect(drive?.provider).toMatchObject({
      authorization: { accessToken: ProviderFixtureCredentials.DRIVE_TOKEN },
    })
    expect(updated.providers.filter((row) => row.id !== 'drive')).toEqual(
      snapshot.providers.filter((row) => row.id !== 'drive'),
    )
  })

  test('the staged and capability wrappers answer by state and are freed once', () => {
    const connected = staged_storage_args(
      ProviderDraftFixture.googleDriveConnected(),
    )
    const thisBrowser = staged_storage_args(ProviderDraftFixture.thisBrowser())
    const capability = provider_kind_replication_capability(
      ProviderSetupKinds.S3,
    )
    const frees = [connected, thisBrowser, capability].map((wrapper) =>
      vi.spyOn(wrapper, 'free'),
    )
    try {
      expect(connected.state).toBe(NookStagedStorageArgsState.Ready)
      expect(thisBrowser.state).toBe(NookStagedStorageArgsState.Incomplete)
      expect(capability.supports(ReplicationType.Personal)).toBe(
        ReplicationSupport.Supported,
      )
      expect(capability.supports(ReplicationType.Shared)).toBe(
        ReplicationSupport.Unsupported,
      )
    } finally {
      connected.free()
      thisBrowser.free()
      capability.free()
    }
    for (const free of frees) expect(free).toHaveBeenCalledTimes(1)
  })
})
