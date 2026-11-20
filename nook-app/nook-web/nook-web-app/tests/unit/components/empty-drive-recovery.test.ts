import { fireEvent, render } from '@testing-library/svelte'
import { err, ok } from 'neverthrow'
import { afterEach, expect, test, vi } from 'vitest'
import {
  NookIdentityLocalAccessKind,
  type NookGoogleDriveVaultListing,
  type ProviderDraft,
  type ProviderVaultSummary,
} from '$app-wasm'
import { OAuthFailure, OAuthFailureKind } from '$lib/auth/oauth-failure'
import {
  IdentityDirectoryLoadKind,
  IdentityDirectorySelectionKind,
} from '$lib/components/devices-access/identity-directory-view'
import { VaultOAuthActions } from '$lib/vault/oauth'
import { FirstRunActions, ProviderFolderBinding } from '$lib/vault/first-run'
import {
  IdentityPlanActions,
  IdentityPlanOutcomeKind,
  type IdentityPlanOutcome,
} from '$lib/vault/identity-plan-actions'
import {
  ProviderDraftFixture,
  ProviderFixtureCredentials,
} from '../provider-fixtures'
import { VaultStateTestFixture } from '../vault-state-test-fixture'
import OAuthProviderSetupWizard from '../../../../nook-web-shared/src/vault-app/lib/components/OAuthProviderSetupWizard.svelte'
import enLocale from '../../../../../nook-platform/nook-app-common/locales/en.json' with { type: 'json' }

const CREATE = 'google-drive-create-keyring'
const EMPTY_ROOTS: NookGoogleDriveVaultListing[] = [
  { root: 'absent' },
  { root: 'found', listing: { identities: [], vaults: [] } },
]

afterEach(() => vi.restoreAllMocks())

function renderRecovery(
  draft: ProviderDraft = ProviderDraftFixture.googleDriveSignedIn(),
) {
  const vault = VaultStateTestFixture.create()
  vault.translations = JSON.stringify(enLocale)
  vault.identityDirectory = {
    kind: IdentityDirectoryLoadKind.Ready,
    view: {
      identities: [],
      selection: { kind: IdentityDirectorySelectionKind.Empty },
    },
  }
  vault.keyringRecoveryOpen = true
  vault.beginKeyringRecovery()
  if (draft.type !== 'oauth-file')
    throw new Error('Expected Google Drive draft')
  vault.stageProviderDraft(draft)
  const onConnect = vi.fn()
  const onCreateEmptyDrive = vi.fn(async () => {})
  const view = render(OAuthProviderSetupWizard, {
    vault,
    draft,
    isVerifying: false,
    isInitializing: false,
    driveRecovery: true,
    onCancelSetup: vi.fn(),
    onConnect,
    onCreateEmptyDrive,
  })
  return { view, vault, onConnect, onCreateEmptyDrive }
}

test('before sign-in, shows the recovery step without a connect action', () => {
  const list = vi.spyOn(VaultOAuthActions.prototype, 'listGoogleDriveVaults')
  const { view } = renderRecovery(
    ProviderDraftFixture.googleDriveAwaitingSignIn(),
  )

  expect(view.getByTestId('google-setup-sync-step').textContent).toContain(
    enLocale.first_run.restore_choose_vault,
  )
  expect(view.queryAllByTestId('connect-provider-btn')).toHaveLength(0)
  expect(list).not.toHaveBeenCalled()
})

test.each(EMPTY_ROOTS)(
  'offers explicit creation when Drive root is $root and has no keyrings',
  async (listing) => {
    vi.spyOn(
      VaultOAuthActions.prototype,
      'listGoogleDriveVaults',
    ).mockResolvedValue(ok(listing))
    const bind = vi.spyOn(
      VaultOAuthActions.prototype,
      'connectGoogleVaultFolder',
    )
    const { view, onConnect, onCreateEmptyDrive } = renderRecovery()

    const create = await view.findByRole('button', {
      name: enLocale.provider_vaults.create_keyring,
    })
    expect(view.queryAllByTestId('connect-provider-btn')).toHaveLength(0)
    await fireEvent.click(create)
    expect(onCreateEmptyDrive).toHaveBeenCalledExactlyOnceWith(
      ProviderFixtureCredentials.DRIVE_TOKEN,
    )
    expect(onConnect).not.toHaveBeenCalled()
    expect(bind).not.toHaveBeenCalled()
  },
)

test('does not offer creation while the Drive read is pending or has failed', async () => {
  type ReadResult = Awaited<
    ReturnType<VaultOAuthActions['listGoogleDriveVaults']>
  >
  let finishRead: (result: ReadResult) => void = () => {}
  const read = new Promise<ReadResult>((resolve) => {
    finishRead = resolve
  })
  vi.spyOn(
    VaultOAuthActions.prototype,
    'listGoogleDriveVaults',
  ).mockReturnValue(read)
  const { view } = renderRecovery()

  await view.findByTestId('google-drive-vaults-loading')
  expect(view.queryAllByTestId(CREATE)).toHaveLength(0)
  expect(view.queryAllByTestId('connect-provider-btn')).toHaveLength(0)
  finishRead(err(new OAuthFailure(OAuthFailureKind.GoogleVaultListing)))

  await view.findByTestId('google-oauth-error')
  expect(view.queryAllByTestId(CREATE)).toHaveLength(0)
  expect(view.queryAllByTestId('connect-provider-btn')).toHaveLength(0)
})

test('keeps recovery when an older keyring is represented by its vault listing', async () => {
  const vault: ProviderVaultSummary = {
    storeId: 'store_othervault1',
    shortId: 'othervau',
    name: { state: 'unknown' },
    identity: {
      identityId: 'idn_strangerabc',
      shortId: 'stranger',
      name: { state: 'unknown' },
      words: ['ripple', 'canvas', 'orbit'],
      log: { state: 'absent' },
    },
    created: { state: 'unreported' },
    lastActivity: { state: 'unreported' },
    eventCount: 0,
    access: { state: 'unchecked' },
  }
  vi.spyOn(
    VaultOAuthActions.prototype,
    'listGoogleDriveVaults',
  ).mockResolvedValue(
    ok({ root: 'found', listing: { identities: [], vaults: [vault] } }),
  )
  const applied: IdentityPlanOutcome = { kind: IdentityPlanOutcomeKind.Applied }
  const run = vi
    .spyOn(IdentityPlanActions.prototype, 'run')
    .mockResolvedValue(ok(applied))
  const finish = vi
    .spyOn(FirstRunActions.prototype, 'connectRecoveredKeyring')
    .mockResolvedValue(true)
  const { view, onConnect } = renderRecovery()

  const card = await view.findByTestId('provider-identity')
  expect(view.queryAllByTestId(CREATE)).toHaveLength(0)
  expect(view.queryAllByTestId('connect-provider-btn')).toHaveLength(0)
  const open = card.querySelector('[data-decision="addToBrowser"]')
  if (!open) throw new Error('Missing recovery action')
  await fireEvent.click(open)

  expect(run).toHaveBeenCalledOnce()
  expect(finish).toHaveBeenCalledExactlyOnceWith(
    ProviderFolderBinding.DriveFolder,
  )
  expect(onConnect).not.toHaveBeenCalled()
})

test('recovery beside a local identity does not offer first-run creation', async () => {
  vi.spyOn(
    VaultOAuthActions.prototype,
    'listGoogleDriveVaults',
  ).mockResolvedValue(ok({ root: 'absent' }))
  const { view, vault } = renderRecovery()
  vault.identityDirectory = {
    kind: IdentityDirectoryLoadKind.Ready,
    view: {
      identities: [
        {
          identityId: 'idn_current',
          words: ['ripple', 'canvas', 'orbit'],
          label: 'Personal',
          localAccess: NookIdentityLocalAccessKind.CurrentBrowser,
          members: [],
          vaults: [],
        },
      ],
      selection: {
        kind: IdentityDirectorySelectionKind.Selected,
        identityId: 'idn_current',
      },
    },
  }
  const empty = await view.findByTestId('google-drive-vaults-empty')
  expect(empty.textContent).toContain(enLocale.first_run.sync_empty)
  expect(view.queryAllByTestId(CREATE)).toHaveLength(0)
  expect(view.queryAllByTestId('connect-provider-btn')).toHaveLength(0)
})
