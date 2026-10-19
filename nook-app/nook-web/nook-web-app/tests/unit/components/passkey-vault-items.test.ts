import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import { describe, expect, test, vi } from 'vitest'
import { fireEvent, render, within } from '@testing-library/svelte'
import {
  SecretType,
  type NookSecretListItem,
  type PasskeyDetailsView,
  type SecretHistoryView,
} from '$lib/nook'
import { VaultStateTestFixture } from '../vault-state-test-fixture'
import AddSecretForm from '$lib/components/AddSecretForm.svelte'
import SecretDetailRow from '$lib/components/SecretDetailRow.svelte'
import { SecretMutationOutcome } from '$lib/vault/secret-operation-failure'
import { ok } from 'neverthrow'
import { SecretComponentTestFixture } from './secret-component-test-fixture'
import {
  PasskeyDetailsPresentationKind,
  SecretHistoryPresentationKind,
  SecretPageInteractionKind,
  type PasskeyDetailsPresentation,
  type SecretHistoryPresentation,
} from '$lib/components/secret-vault-state'

const vault = VaultStateTestFixture.create()
vi.spyOn(vault, 't').mockImplementation((request) =>
  typeof request === 'string' ? request : request.key,
)
vi.spyOn(vault, 'resolveErrorMessage').mockImplementation((message) => message)

const details: PasskeyDetailsView = {
  credentialId: 'Y3JlZGVudGlhbC1pZC1maXh0dXJl',
  relyingPartyName: 'Example Login',
  distinctUserName: 'alice@example.com',
  algorithmLabelKey: I18N_KEYS.VaultFieldsPasskeyAlgorithmEs256,
  publicKeyFingerprint: 'SHA256:9+DIAhGaEvPhUkquTXtzDLd10GrycDMuT91vONRZCiY',
  signatureCount: 7,
  discoverableLabelKey: I18N_KEYS.VaultFieldsPasskeyDiscoverableYes,
  backupStatusLabelKey: I18N_KEYS.VaultFieldsPasskeyBackupBackedUp,
}

type PasskeyDetailRender = {
  readonly item: NookSecretListItem
  readonly passkeyDetails: PasskeyDetailsPresentation
}

class PasskeyDetailRenderer {
  static passkey(
    fields: Parameters<typeof SecretComponentTestFixture.listItem>[0] = {},
  ): NookSecretListItem {
    return SecretComponentTestFixture.listItem({
      id: 'secret_passkey',
      type: SecretType.Passkey,
      rpId: 'login.example.com',
      passkeyUserName: 'alice@example.com',
      passkeyUserDisplayName: 'Alice',
      ...fields,
    })
  }

  static render(
    { item, passkeyDetails }: PasskeyDetailRender,
    secretHistory: SecretHistoryPresentation = {
      kind: SecretHistoryPresentationKind.Hidden,
    },
  ) {
    return render(SecretDetailRow, {
      item,
      row: 1,
      expanded: true,
      pageInteraction: SecretPageInteractionKind.Ready,
      passkeyDetails,
      secretHistory,
      onToggleExpand: vi.fn(),
      onToggleReveal: vi.fn(async () => {}),
      onEditItem: vi.fn(async () => {}),
      onDeleteSecret: vi.fn(async () =>
        ok<SecretMutationOutcome.Deleted, never>(SecretMutationOutcome.Deleted),
      ),
      onCopyToClipboard: vi.fn(async () => {}),
      onCopySecret: vi.fn(async () => {}),
      vault,
    })
  }
}

describe('passkey item discovery', () => {
  test('shows the website ceremony path without a manual credential form', async () => {
    const onAddSecret = vi.fn(async () =>
      ok<SecretMutationOutcome.Added, never>(SecretMutationOutcome.Added),
    )
    const view = render(AddSecretForm, {
      vault,
      isSaving: false,
      onAddSecret,
      onGeneratePassword: vi.fn(() => 'generated'),
      onCancel: vi.fn(),
    })

    await fireEvent.click(view.getByTestId('item-type-passkey'))

    expect(view.getByTestId('passkey-creation-guidance')).toBeTruthy()
    expect(view.getByText(I18N_KEYS.AddSecretPasskeyCreationTitle)).toBeTruthy()
    expect(view.queryAllByTestId('save-secret-btn')).toHaveLength(0)
    expect(onAddSecret).not.toHaveBeenCalled()
  })

  test('renders public passkey details without reveal or edit actions', () => {
    const request: PasskeyDetailRender = {
      item: PasskeyDetailRenderer.passkey(),
      passkeyDetails: {
        kind: PasskeyDetailsPresentationKind.Loaded,
        id: 'secret_passkey',
        details,
      },
    }
    const view = PasskeyDetailRenderer.render(request)

    const detail = within(view.getByTestId('secret-detail'))
    expect(detail.getByText(I18N_KEYS.VaultTypesPasskey)).toBeTruthy()
    expect(detail.getByTestId('secret-detail-title').textContent).toContain(
      'login.example.com',
    )
    expect(detail.getByText('Alice')).toBeTruthy()
    expect(detail.getByTestId('passkey-user-name').textContent).toContain(
      'alice@example.com',
    )
    expect(
      detail.getByTestId('passkey-relying-party-name').textContent,
    ).toContain('Example Login')
    expect(detail.getByTestId('passkey-credential-id').textContent).toContain(
      details.credentialId,
    )
    expect(
      detail.getByTestId('passkey-public-key-fingerprint').textContent,
    ).toContain(details.publicKeyFingerprint)
    expect(detail.getByTestId('passkey-algorithm').textContent).toContain(
      I18N_KEYS.VaultFieldsPasskeyAlgorithmEs256,
    )
    expect(detail.getByTestId('passkey-signature-count').textContent).toContain(
      '7',
    )
    expect(detail.getByTestId('passkey-discoverable').textContent).toContain(
      I18N_KEYS.VaultFieldsPasskeyDiscoverableYes,
    )
    expect(detail.getByTestId('passkey-backup').textContent).toContain(
      I18N_KEYS.VaultFieldsPasskeyBackupBackedUp,
    )
    expect(detail.getByLabelText(I18N_KEYS.VaultCopyCredentialId)).toBeTruthy()
    expect(
      detail.getByLabelText(I18N_KEYS.VaultCopyPublicKeyFingerprint),
    ).toBeTruthy()
    expect(view.queryAllByTestId('reveal-secret-btn')).toHaveLength(0)
    expect(view.queryAllByTestId('edit-secret-btn')).toHaveLength(0)
    expect(view.getByTestId('delete-secret-btn')).toBeTruthy()
  })

  test('shows the account once when the user name repeats the display name', () => {
    const request: PasskeyDetailRender = {
      item: PasskeyDetailRenderer.passkey({
        passkeyUserName: 'Alice',
        passkeyUserDisplayName: 'Alice',
      }),
      passkeyDetails: {
        kind: PasskeyDetailsPresentationKind.Loaded,
        id: 'secret_passkey',
        details: {
          ...details,
          relyingPartyName: undefined,
          distinctUserName: undefined,
        },
      },
    }
    const view = PasskeyDetailRenderer.render(request)

    const detail = within(view.getByTestId('secret-detail'))
    expect(detail.getAllByText('Alice')).toHaveLength(1)
    expect(detail.queryAllByTestId('passkey-user-name')).toHaveLength(0)
    expect(detail.queryAllByTestId('passkey-relying-party-name')).toHaveLength(
      0,
    )
  })

  test('renders loading and explicit failure states instead of default values', () => {
    const loading: PasskeyDetailRender = {
      item: PasskeyDetailRenderer.passkey(),
      passkeyDetails: {
        kind: PasskeyDetailsPresentationKind.Loading,
        id: 'secret_passkey',
      },
    }
    const loadingView = PasskeyDetailRenderer.render(loading)
    expect(
      loadingView.getByTestId('passkey-details-loading').textContent,
    ).toContain(I18N_KEYS.VaultFieldsPasskeyDetailsLoading)
    expect(loadingView.queryAllByTestId('passkey-credential-id')).toHaveLength(
      0,
    )
    loadingView.unmount()

    const failed: PasskeyDetailRender = {
      item: PasskeyDetailRenderer.passkey(),
      passkeyDetails: {
        kind: PasskeyDetailsPresentationKind.Failed,
        id: 'secret_passkey',
      },
    }
    const failedView = PasskeyDetailRenderer.render(failed)
    const error = failedView.getByTestId('passkey-details-error')
    expect(error.textContent).toContain(
      I18N_KEYS.VaultFieldsPasskeyDetailsUnavailable,
    )
    expect(error.getAttribute('role')).toBe('alert')
    expect(failedView.queryAllByTestId('passkey-credential-id')).toHaveLength(0)
    expect(failedView.queryAllByTestId('passkey-signature-count')).toHaveLength(
      0,
    )
  })

  test('renders event-log history with truthful origin labels and devices', () => {
    const history: SecretHistoryView = {
      originLabelKey: I18N_KEYS.VaultFieldsHistoryCreated,
      originAt: '2026-01-02T03:04:05Z',
      originDeviceLabelKey: I18N_KEYS.VaultFieldsHistoryDeviceThis,
      originDeviceValue: '',
      modifiedAt: '2026-03-01T00:00:00Z',
      modifiedDeviceLabelKey: I18N_KEYS.VaultFieldsHistoryDeviceNamed,
      modifiedDeviceValue: 'Work laptop',
    }
    const request: PasskeyDetailRender = {
      item: PasskeyDetailRenderer.passkey(),
      passkeyDetails: { kind: PasskeyDetailsPresentationKind.Hidden },
    }
    const view = PasskeyDetailRenderer.render(request, {
      kind: SecretHistoryPresentationKind.Loaded,
      id: 'secret_passkey',
      history,
    })

    const origin = view.getByTestId('history-origin')
    expect(origin.textContent).toContain(I18N_KEYS.VaultFieldsHistoryCreated)
    expect(origin.querySelector('time')?.getAttribute('datetime')).toBe(
      '2026-01-02T03:04:05Z',
    )
    expect(view.getByTestId('history-origin-device').textContent).toContain(
      I18N_KEYS.VaultFieldsHistoryDeviceThis,
    )
    expect(
      view
        .getByTestId('history-modified')
        .querySelector('time')
        ?.getAttribute('datetime'),
    ).toBe('2026-03-01T00:00:00Z')
    expect(vault.t).toHaveBeenCalledWith({
      key: I18N_KEYS.VaultFieldsHistoryDeviceNamed,
      replacements: { device: 'Work laptop' },
    })
    view.unmount()

    const carried = PasskeyDetailRenderer.render(request, {
      kind: SecretHistoryPresentationKind.Loaded,
      id: 'secret_passkey',
      history: {
        ...history,
        originLabelKey: I18N_KEYS.VaultFieldsHistoryInVaultSince,
        originDeviceLabelKey: undefined,
        modifiedAt: undefined,
        modifiedDeviceLabelKey: undefined,
      },
    })
    expect(carried.getByTestId('history-origin').textContent).toContain(
      I18N_KEYS.VaultFieldsHistoryInVaultSince,
    )
    expect(carried.queryAllByTestId('history-origin-device')).toHaveLength(0)
    expect(carried.queryAllByTestId('history-modified')).toHaveLength(0)
    expect(carried.queryAllByTestId('history-modified-device')).toHaveLength(0)
  })

  test('shows an explicit error when the history cannot be derived', () => {
    const request: PasskeyDetailRender = {
      item: PasskeyDetailRenderer.passkey(),
      passkeyDetails: { kind: PasskeyDetailsPresentationKind.Hidden },
    }
    const view = PasskeyDetailRenderer.render(request, {
      kind: SecretHistoryPresentationKind.Failed,
      id: 'secret_passkey',
    })
    const error = view.getByTestId('history-error')
    expect(error.textContent).toContain(I18N_KEYS.VaultFieldsHistoryUnavailable)
    expect(error.getAttribute('role')).toBe('alert')
    expect(view.queryAllByTestId('history-origin')).toHaveLength(0)
  })
})
