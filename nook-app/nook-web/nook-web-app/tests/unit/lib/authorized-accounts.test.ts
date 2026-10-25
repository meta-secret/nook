import { afterEach, describe, expect, test, vi } from 'vitest'
import { ok } from 'neverthrow'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import {
  defaultOAuthFileConfig,
  storedGoogleDriveFolder,
  storedICloudShareTarget,
  storedOAuthCredential,
  type OAuthFileConfig,
} from '$lib/auth/providers'
import { googleOAuthSession } from '$lib/auth/google/oauth'
import { iCloudOAuthSession } from '$lib/auth/icloud/oauth'
import {
  AuthorizedAccountsFailureKind,
  AuthorizedAccountsSource,
  authorizedAccountsClient,
} from '$lib/vault/authorized-accounts'

const wasm = vi.hoisted(() => ({
  listGoogleDriveAuthorizedAccounts: vi.fn(),
  addGoogleDriveAuthorizedAccount: vi.fn(),
}))

vi.mock('$app-wasm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$app-wasm')>()),
  list_google_drive_authorized_accounts: wasm.listGoogleDriveAuthorizedAccounts,
  add_google_drive_authorized_account: wasm.addGoogleDriveAuthorizedAccount,
}))

const ICLOUD_TARGET =
  'icloud-share-v1:{"role":"owner","zoneName":"zone","ownerRecordName":"owner","rootRecordName":"root","shortGuid":"guid"}'

function driveConfig(): OAuthFileConfig {
  return {
    ...defaultOAuthFileConfig({ preset: 'google-drive', fileName: 'vault' }),
    accessToken: storedOAuthCredential('drive-token'),
    folderId: storedGoogleDriveFolder('vault-folder'),
  }
}

describe('authorized accounts client', () => {
  afterEach(() => vi.restoreAllMocks())

  test('needs the vault folder before it can list Drive accounts', async () => {
    const unbound: OAuthFileConfig = {
      ...driveConfig(),
      folderId: { state: 'root' },
    }
    const access = await authorizedAccountsClient.access(unbound)
    expect(access.isErr()).toBe(true)
    if (access.isOk()) return
    expect(access.error.kind).toBe(AuthorizedAccountsFailureKind.TargetRequired)
    expect(access.error.translationKey).toBe(
      I18N_KEYS.AuthorizedAccountsTargetRequired,
    )
  })

  test('lists Drive accounts with a fresh token for the vault folder', async () => {
    const config = driveConfig()
    vi.spyOn(
      googleOAuthSession,
      'ensureValidOAuthFileConfig',
    ).mockResolvedValue(ok(config))
    const accounts = { accounts: [] }
    wasm.listGoogleDriveAuthorizedAccounts.mockResolvedValue(accounts)

    const access = await authorizedAccountsClient.access(config)
    expect(access).toEqual(
      ok({
        source: AuthorizedAccountsSource.GoogleDrive,
        accessToken: 'drive-token',
        folderId: 'vault-folder',
      }),
    )
    if (access.isErr()) return
    await expect(authorizedAccountsClient.list(access.value)).resolves.toEqual(
      ok(accounts),
    )
    expect(wasm.listGoogleDriveAuthorizedAccounts).toHaveBeenCalledWith(
      'drive-token',
      'vault-folder',
    )
  })

  test('shows the Rust rule when an account already has access', async () => {
    wasm.addGoogleDriveAuthorizedAccount.mockRejectedValue(
      new Error(I18N_KEYS.ErrorsValidationAuthorizedAccountExists),
    )
    const added = await authorizedAccountsClient.add({
      access: {
        source: AuthorizedAccountsSource.GoogleDrive,
        accessToken: 'drive-token',
        folderId: 'vault-folder',
      },
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
      access: {
        source: AuthorizedAccountsSource.GoogleDrive,
        accessToken: 'drive-token',
        folderId: 'vault-folder',
      },
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
    const config: OAuthFileConfig = {
      ...defaultOAuthFileConfig({ preset: 'icloud', fileName: 'vault' }),
      accessToken: storedOAuthCredential('cloudkit-token'),
      iCloudShareTarget: storedICloudShareTarget(ICLOUD_TARGET),
    }
    const access = await authorizedAccountsClient.access(config)
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
  })
})
