import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import { describe, expect, test, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/svelte'
import { SecretType, type NookSecretListItem } from '$lib/nook'
import type { VaultState } from '$lib/vault.svelte'
import AddSecretForm from '$lib/components/AddSecretForm.svelte'
import SecretDetailRow from '$lib/components/SecretDetailRow.svelte'

const vault = {
  t(key: string): string {
    return key
  },
  resolveErrorMessage(message: string): string {
    return message
  },
} as unknown as VaultState

describe('passkey item discovery', () => {
  test('shows the website ceremony path without a manual credential form', async () => {
    const onAddSecret = vi.fn(async () => {})
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
    const item = {
      id: 'secret_passkey',
      type: SecretType.Passkey,
      rpId: 'login.example.com',
      passkeyUserName: 'alice@example.com',
      passkeyUserDisplayName: 'Alice',
    } as NookSecretListItem
    const view = render(SecretDetailRow, {
      item,
      index: 0,
      expanded: true,
      onToggleExpand: vi.fn(),
      onToggleReveal: vi.fn(async () => {}),
      onEditItem: vi.fn(async () => {}),
      onDeleteSecret: vi.fn(async () => {}),
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
