import { afterEach, describe, expect, test, vi } from 'vitest'
import { err, ok } from 'neverthrow'
import { OAuthFailure, OAuthFailureKind } from '$lib/auth/oauth-failure'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import type { OAuthFileProvider, StorageProvider } from '$app-wasm'
import { GoogleOAuthPrompt, googleOAuthSession } from '$lib/auth/google/oauth'
import { iCloudOAuthSession } from '$lib/auth/icloud/oauth'
import {
  AuthorizedAccountsFailureKind,
  AuthorizedAccountsSource,
  authorizedAccountsClient,
} from '$lib/vault/authorized-accounts'
import {
  SharedJoinerSelectionKind,
  SharedJoinerSelections,
} from '$lib/vault/shared-joiner-selection'
import {
  ProviderFixtureCredentials,
  ProviderRowFixture,
} from '../provider-fixtures'

const wasm = vi.hoisted(() => ({
  listGoogleDriveAuthorizedAccounts: vi.fn(),
  addGoogleDriveAuthorizedAccount: vi.fn(),
}))

vi.mock('$app-wasm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$app-wasm')>()),
  list_google_drive_authorized_accounts: wasm.listGoogleDriveAuthorizedAccounts,
  add_google_drive_authorized_account: wasm.addGoogleDriveAuthorizedAccount,
}))

/** The OAuth payload of a saved Drive or iCloud row. */
function oauthPayload(row: StorageProvider): OAuthFileProvider {
  switch (row.provider.type) {
    case 'oauth-file':
      return row.provider
    case 'local':
    case 'local-folder':
    case 'github':
    case 's3':
      throw new Error('expected an OAuth file provider row')
  }
}

function drivePayload(): OAuthFileProvider {
  return oauthPayload(
    ProviderRowFixture.googleDrive(ProviderRowFixture.unscoped('drive')),
  )
}

const SHARED_TOKENS = {
  accessToken: 'shared-token',
  expiresAt: '2030-01-01T00:00:00.000Z',
}

const DRIVE_ACCESS = {
  source: AuthorizedAccountsSource.GoogleDrive,
  accessToken: 'drive-token',
  folderId: 'vault-folder',
  accountHint: 'owner@example.com',
} as const

describe('authorized accounts client', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    wasm.addGoogleDriveAuthorizedAccount.mockReset()
  })

  test('needs a readable iCloud share before it can list its accounts', async () => {
    const unreadable: OAuthFileProvider = {
      preset: 'icloud',
      webAuthToken: ProviderFixtureCredentials.ICLOUD_TOKEN,
      account: { state: 'unknown' },
      shareTarget: 'not-a-share',
    }
    const access = await authorizedAccountsClient.access(unreadable)
    expect(access.isErr()).toBe(true)
    if (access.isOk()) return
    expect(access.error.kind).toBe(AuthorizedAccountsFailureKind.TargetRequired)
    expect(access.error.translationKey).toBe(
      I18N_KEYS.AuthorizedAccountsTargetRequired,
    )
  })

  test('lists Drive accounts with a fresh token for the vault folder', async () => {
    const payload = drivePayload()
    const fresh = vi
      .spyOn(googleOAuthSession, 'ensureFreshDriveAccess')
      .mockImplementation(async (current) => ok(current))
    const accounts = { accounts: [] }
    wasm.listGoogleDriveAuthorizedAccounts.mockResolvedValue(accounts)

    const access = await authorizedAccountsClient.access(payload)
    expect(fresh).toHaveBeenCalledOnce()
    expect(access).toEqual(
      ok({
        source: AuthorizedAccountsSource.GoogleDrive,
        accessToken: ProviderFixtureCredentials.DRIVE_TOKEN,
        folderId: ProviderFixtureCredentials.DRIVE_FOLDER,
        accountHint: ProviderFixtureCredentials.ACCOUNT,
      }),
    )
    if (access.isErr()) return
    await expect(authorizedAccountsClient.list(access.value)).resolves.toEqual(
      ok(accounts),
    )
    expect(wasm.listGoogleDriveAuthorizedAccounts).toHaveBeenCalledWith(
      ProviderFixtureCredentials.DRIVE_TOKEN,
      ProviderFixtureCredentials.DRIVE_FOLDER,
    )
  })

  test('asks the Drive owner to sign in again when the refresh fails', async () => {
    vi.spyOn(googleOAuthSession, 'ensureFreshDriveAccess').mockResolvedValue(
      err(new OAuthFailure(OAuthFailureKind.GoogleCancelled)),
    )
    const access = await authorizedAccountsClient.access(drivePayload())
    expect(access.isErr()).toBe(true)
    if (access.isOk()) return
    expect(access.error.kind).toBe(AuthorizedAccountsFailureKind.SignInRequired)
  })

  test('asks the owner for drive.readonly from the click, then shares with that grant', async () => {
    const grant = vi
      .spyOn(googleOAuthSession, 'requestGoogleDriveSharedAccess')
      .mockResolvedValue(ok(SHARED_TOKENS))
    const accounts = { accounts: [] }
    wasm.addGoogleDriveAuthorizedAccount.mockResolvedValue(accounts)

    const added = await authorizedAccountsClient.add({
      access: DRIVE_ACCESS,
      email: 'member@example.com',
    })

    expect(grant).toHaveBeenCalledWith({
      prompt: GoogleOAuthPrompt.Default,
      accountHint: 'owner@example.com',
    })
    expect(wasm.addGoogleDriveAuthorizedAccount).toHaveBeenCalledWith(
      'shared-token',
      'vault-folder',
      'member@example.com',
    )
    expect(added).toEqual(
      ok({
        accounts,
        access: { ...DRIVE_ACCESS, accessToken: 'shared-token' },
        tokens: SHARED_TOKENS,
      }),
    )
  })

  test('authorizes no account when the owner declines the read grant', async () => {
    vi.spyOn(
      googleOAuthSession,
      'requestGoogleDriveSharedAccess',
    ).mockResolvedValue(err(new OAuthFailure(OAuthFailureKind.GoogleCancelled)))

    const added = await authorizedAccountsClient.add({
      access: DRIVE_ACCESS,
      email: 'member@example.com',
    })

    expect(added.isErr()).toBe(true)
    if (added.isOk()) return
    expect(added.error.kind).toBe(AuthorizedAccountsFailureKind.ReadAccess)
    expect(added.error.translationKey).toBe(
      I18N_KEYS.AuthorizedAccountsDriveReadAccessRequired,
    )
    expect(wasm.addGoogleDriveAuthorizedAccount).not.toHaveBeenCalled()
  })

  test('shows the Rust rule when an account already has access', async () => {
    vi.spyOn(
      googleOAuthSession,
      'requestGoogleDriveSharedAccess',
    ).mockResolvedValue(ok(SHARED_TOKENS))
    wasm.addGoogleDriveAuthorizedAccount.mockRejectedValue(
      new Error(I18N_KEYS.ErrorsValidationAuthorizedAccountExists),
    )
    const added = await authorizedAccountsClient.add({
      access: DRIVE_ACCESS,
      email: 'member@example.com',
    })
    expect(added.isErr()).toBe(true)
    if (added.isOk()) return
    expect(added.error.translationKey).toBe(
      I18N_KEYS.ErrorsValidationAuthorizedAccountExists,
    )

    wasm.addGoogleDriveAuthorizedAccount.mockRejectedValue(
      new Error('Google Drive API responded with status 403'),
    )
    const failed = await authorizedAccountsClient.add({
      access: DRIVE_ACCESS,
      email: 'member@example.com',
    })
    expect(failed.isErr()).toBe(true)
    if (failed.isOk()) return
    expect(failed.error.translationKey).toBe(
      I18N_KEYS.AuthorizedAccountsAddFailed,
    )
  })

  test('reads iCloud accounts from the share participants', async () => {
    vi.spyOn(iCloudOAuthSession, 'fetchShareParticipants').mockResolvedValue(
      ok({
        participants: [
          {
            participantId: 'owner',
            type: 'OWNER',
            permission: 'READ_WRITE',
            acceptanceStatus: 'ACCEPTED',
            emailAddress: 'owner@icloud.com',
          },
          {
            participantId: 'member',
            type: 'PRIVATE_USER',
            permission: 'READ_WRITE',
            acceptanceStatus: 'INVITED',
            emailAddress: 'member@icloud.com',
          },
        ],
      }),
    )
    const access = await authorizedAccountsClient.access(
      oauthPayload(
        ProviderRowFixture.icloud(ProviderRowFixture.unscoped('icloud')),
      ),
    )
    expect(access.isOk()).toBe(true)
    if (access.isErr()) return
    const listed = await authorizedAccountsClient.list(access.value)
    expect(listed.isOk()).toBe(true)
    if (listed.isErr()) return
    expect(
      listed.value.accounts.map((account) => [
        account.email,
        account.role,
        account.status,
      ]),
    ).toEqual([
      ['owner@icloud.com', 'owner', 'active'],
      ['member@icloud.com', 'writer', 'invited'],
    ])
    // Rust decides which account an invite may name.
    expect(
      authorizedAccountsClient.inviteAccount({
        accounts: listed.value,
        email: 'MEMBER@icloud.com',
      }),
    ).toEqual(ok('member@icloud.com'))
    // A picked joiner stays picked while the list still invites it.
    expect(
      SharedJoinerSelections.reconcile({
        selection: SharedJoinerSelections.selected('MEMBER@icloud.com'),
        accounts: listed.value,
      }),
    ).toEqual(SharedJoinerSelections.selected('member@icloud.com'))
    expect(
      SharedJoinerSelections.reconcile({
        selection: SharedJoinerSelections.selected('gone@icloud.com'),
        accounts: listed.value,
      }).kind,
    ).toBe(SharedJoinerSelectionKind.None)
    expect(
      SharedJoinerSelections.reconcile({
        selection: SharedJoinerSelections.NONE,
        accounts: listed.value,
      }),
    ).toEqual(SharedJoinerSelections.NONE)
  })
})
