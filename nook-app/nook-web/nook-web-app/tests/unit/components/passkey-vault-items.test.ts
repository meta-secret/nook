import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import { describe, expect, test, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/svelte'
import { SecretType } from '$lib/nook'
import { VaultStateTestFixture } from '../vault-state-test-fixture'
import AddSecretForm from '$lib/components/AddSecretForm.svelte'
import SecretDetailRow from '$lib/components/SecretDetailRow.svelte'
import { ok } from 'neverthrow'
import { SecretComponentTestFixture } from './secret-component-test-fixture'

const vault = VaultStateTestFixture.create()
vi.spyOn(vault, 't').mockImplementation((request) =>
  typeof request === 'string' ? request : request.key,
)
vi.spyOn(vault, 'resolveErrorMessage').mockImplementation((message) => message)

describe('passkey item discovery', () => {
  test('shows the website ceremony path without a manual credential form', async () => {
    const onAddSecret = vi.fn(async () => ok())
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

  test('renders safe passkey metadata without reveal, copy, or edit actions', () => {
    const item = SecretComponentTestFixture.listItem({
      id: 'secret_passkey',
      type: SecretType.Passkey,
      rpId: 'login.example.com',
      passkeyUserName: 'alice@example.com',
      passkeyUserDisplayName: 'Alice',
    })
    const view = render(SecretDetailRow, {
      item,
      index: 0,
      expanded: true,
      onToggleExpand: vi.fn(),
      onToggleReveal: vi.fn(async () => {}),
      onEditItem: vi.fn(async () => {}),
      onDeleteSecret: vi.fn(async () => ok()),
      onCopyToClipboard: vi.fn(async () => {}),
      onCopySecret: vi.fn(async () => {}),
      vault,
    })

    expect(view.getByText(I18N_KEYS.VaultTypesPasskey)).toBeTruthy()
    expect(view.getByText('login.example.com')).toBeTruthy()
    expect(view.getByText('Alice')).toBeTruthy()
    expect(view.getByText('alice@example.com')).toBeTruthy()
    expect(view.queryAllByTestId('reveal-secret-btn')).toHaveLength(0)
    expect(view.queryAllByTestId('edit-secret-btn')).toHaveLength(0)
    expect(view.getByTestId('delete-secret-btn')).toBeTruthy()
  })
})
