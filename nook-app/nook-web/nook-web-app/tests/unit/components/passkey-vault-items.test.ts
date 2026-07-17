import { describe, expect, test, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/svelte'
import type { NookSecretListItem } from '$lib/nook'
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
    expect(view.getByText('add_secret.passkey_creation_title')).toBeTruthy()
    expect(view.queryByTestId('save-secret-btn')).toBeNull()
    expect(onAddSecret).not.toHaveBeenCalled()
  })

  test('renders safe passkey metadata without reveal, copy, or edit actions', () => {
    const item = {
      id: 'secret_passkey',
      type: 'passkey',
      rpId: 'login.example.com',
      passkeyUserName: 'alice@example.com',
      passkeyUserDisplayName: 'Alice',
    } as NookSecretListItem
    const view = render(SecretDetailRow, {
      item,
      index: 0,
      expanded: true,
      decrypted: undefined,
      copiedKey: undefined,
      onToggleExpand: vi.fn(),
      onToggleReveal: vi.fn(async () => {}),
      onEditItem: vi.fn(async () => {}),
      onDeleteSecret: vi.fn(async () => {}),
      onCopyToClipboard: vi.fn(async () => {}),
      onCopySecret: vi.fn(async () => {}),
      vault,
    })

    expect(view.getByText('vault.types.passkey')).toBeTruthy()
    expect(view.getByText('login.example.com')).toBeTruthy()
    expect(view.getByText('Alice')).toBeTruthy()
    expect(view.getByText('alice@example.com')).toBeTruthy()
    expect(view.queryByTestId('reveal-secret-btn')).toBeNull()
    expect(view.queryByTestId('edit-secret-btn')).toBeNull()
    expect(view.getByTestId('delete-secret-btn')).toBeTruthy()
  })
})
