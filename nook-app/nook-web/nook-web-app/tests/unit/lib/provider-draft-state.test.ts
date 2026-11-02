import { describe, expect, test } from 'vitest'
import {
  begin_provider_draft,
  JoinEnrollmentState,
  provider_draft_kind,
  type ProviderKind,
} from '$app-wasm'
import { VaultProviderActions } from '$lib/vault/providers.svelte'
import { ProviderSetupKinds } from '$lib/vault/provider-setup-kinds'
import { StagedRemoteStorageKind } from '$lib/vault/state/provider.svelte'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import {
  ProviderDraftFixture,
  ProviderFixtureCredentials,
  ProviderRowFixture,
} from '../provider-fixtures'
import { VaultStateTestFixture } from '../vault-state-test-fixture'

const SETUP_KINDS: readonly ProviderKind[] = [
  ProviderSetupKinds.THIS_BROWSER,
  ProviderSetupKinds.LOCAL_FOLDER,
  ProviderSetupKinds.GITHUB,
  ProviderSetupKinds.GOOGLE_DRIVE,
  ProviderSetupKinds.ICLOUD,
  ProviderSetupKinds.S3,
]

describe('the one provider draft', () => {
  test('starts as this browser and begins the kind a setup picks', () => {
    const state = VaultStateTestFixture.create()
    expect(state.providerDraft).toEqual(ProviderDraftFixture.thisBrowser())
    for (const kind of SETUP_KINDS) {
      new VaultProviderActions(state).beginProviderSetup({ kind })
      expect(provider_draft_kind(state.providerDraft)).toEqual(kind)
    }
  })

  test('this browser leaves no credential behind', () => {
    const state = VaultStateTestFixture.create()
    state.stageProviderDraft(ProviderDraftFixture.githubEntered())
    state.useThisBrowser()
    expect(state.providerDraft).toEqual(ProviderDraftFixture.thisBrowser())
  })

  test.each([
    ['GitHub', ProviderDraftFixture.githubEntered, ProviderSetupKinds.GITHUB],
    [
      'Google Drive',
      ProviderDraftFixture.googleDriveConnected,
      ProviderSetupKinds.GOOGLE_DRIVE,
    ],
    ['iCloud', ProviderDraftFixture.icloudShared, ProviderSetupKinds.ICLOUD],
    [
      'local folder',
      ProviderDraftFixture.localFolderSelected,
      ProviderSetupKinds.LOCAL_FOLDER,
    ],
    ['S3', ProviderDraftFixture.s3Ready, ProviderSetupKinds.S3],
  ])(
    'a lock keeps the %s kind and nothing it gathered',
    (_name, build, kind) => {
      const state = VaultStateTestFixture.create()
      state.stageProviderDraft(build())
      state.forgetDraftCredentials()
      expect(state.providerDraft).toEqual(begin_provider_draft(kind))
    },
  )

  test('the projection keeps a setup of the same kind and stages the first sync row otherwise', () => {
    const state = VaultStateTestFixture.create()
    const row = ProviderRowFixture.github(ProviderRowFixture.unscoped('gh'))
    state.providers = [row]
    state.applyActiveProviderCredentials()
    expect(state.providerDraft).toMatchObject({
      type: 'github',
      token: {
        state: 'entered',
        value: ProviderFixtureCredentials.GITHUB_TOKEN,
      },
    })

    state.activateLoginSetup(ProviderSetupKinds.S3)
    state.stageProviderDraft(ProviderDraftFixture.s3Ready())
    state.applyActiveProviderCredentials()
    expect(state.providerDraft).toEqual(ProviderDraftFixture.s3Ready())
  })

  test('with a local vault present the projection is this browser', () => {
    const state = VaultStateTestFixture.create()
    state.providers = [
      ProviderRowFixture.github(ProviderRowFixture.unscoped('gh')),
    ]
    state.localVaultPresent = true
    state.applyActiveProviderCredentials()
    expect(state.providerDraft).toEqual(ProviderDraftFixture.thisBrowser())
  })

  test('cancelling a setup drops its draft for the provider in use', () => {
    const state = VaultStateTestFixture.create()
    new VaultProviderActions(state).beginProviderSetup({
      kind: ProviderSetupKinds.GITHUB,
    })
    state.stageProviderDraft(ProviderDraftFixture.githubEntered())
    state.cancelProviderSetup()
    expect(state.providerDraft).toEqual(ProviderDraftFixture.thisBrowser())
  })
})

describe('connecting from the draft', () => {
  test('a GitHub draft awaiting its token fails closed with its gap', () => {
    // D2 regression: this connected with an empty token before.
    const state = VaultStateTestFixture.create()
    state.activateLoginSetup(ProviderSetupKinds.GITHUB)
    state.stageProviderDraft(ProviderDraftFixture.githubAwaitingToken())
    const args = new VaultProviderActions(state).wasmStorageArgs()
    expect(args.isErr()).toBe(true)
    if (args.isOk()) return
    expect(args.error.translationKey).toBe(
      I18N_KEYS.ErrorsValidationGithubPatEmpty,
    )
  })

  test.each([
    ['Google Drive', ProviderDraftFixture.googleDriveAwaitingSignIn],
    ['S3', ProviderDraftFixture.s3Awaiting],
  ])(
    'an incomplete %s draft no longer connects this browser',
    (_name, build) => {
      const state = VaultStateTestFixture.create()
      state.stageProviderDraft(build())
      expect(new VaultProviderActions(state).wasmStorageArgs().isErr()).toBe(
        true,
      )
    },
  )

  test('a Drive draft bound to its folder connects and stages through Rust', () => {
    const state = VaultStateTestFixture.create()
    state.activateLoginSetup(ProviderSetupKinds.GOOGLE_DRIVE)
    state.stageProviderDraft(ProviderDraftFixture.googleDriveConnected())
    const actions = new VaultProviderActions(state)
    expect(actions.wasmStorageArgs()._unsafeUnwrap()).toEqual({
      mode: 'google-drive',
      token: ProviderFixtureCredentials.DRIVE_TOKEN,
      folderId: ProviderFixtureCredentials.DRIVE_FOLDER,
    })
    expect(actions.stagedRemoteStorageArgs().kind).toBe(
      StagedRemoteStorageKind.Available,
    )
  })

  test('a signed-in Drive draft without its folder stages nothing', () => {
    const state = VaultStateTestFixture.create()
    state.stageProviderDraft(ProviderDraftFixture.googleDriveSignedIn())
    expect(new VaultProviderActions(state).stagedRemoteStorageArgs()).toEqual({
      kind: StagedRemoteStorageKind.Unavailable,
    })
  })

  test('a join connects through the join provider and otherwise through the draft', () => {
    const state = VaultStateTestFixture.create()
    state.providers = [
      ProviderRowFixture.github(ProviderRowFixture.unscoped('gh')),
    ]
    state.stageProviderDraft(ProviderDraftFixture.s3Ready())
    state.joinEnrollmentPrompt = JoinEnrollmentState.NeedsRequest
    expect(
      new VaultProviderActions(state).connectStorageArgs()._unsafeUnwrap(),
    ).toMatchObject({ mode: 'github' })

    state.joinEnrollmentPrompt = JoinEnrollmentState.None
    expect(
      new VaultProviderActions(state).connectStorageArgs()._unsafeUnwrap(),
    ).toMatchObject({ mode: 's3' })
  })
})
