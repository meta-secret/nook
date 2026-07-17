import { describe, expect, test, vi } from 'vitest'
import { render } from '@testing-library/svelte'
import type { NookSecretListItem } from '$lib/nook'
import type { VaultState } from '$lib/vault.svelte'
import SecretDetailRow from '$lib/components/SecretDetailRow.svelte'

const vault = {
  t(key: string): string {
    return key === 'vault.fields.no_website' ? 'Localized no website' : key
  },
} as unknown as VaultState

function loginItem(
  websiteUrl: string,
  groupKey: string,
): NookSecretListItem {
  return {
    id: 'secret_login',
    type: 'login',
    displayTitle: websiteUrl,
    groupKey,
    summary: 'alice@example.com',
    websiteUrl,
    username: 'alice@example.com',
  } as unknown as NookSecretListItem
}

function renderLogin(item: NookSecretListItem) {
  return render(SecretDetailRow, {
    item,
    index: 0,
    expanded: false,
    decrypted: undefined,
    copiedKey: undefined,
    onToggleExpand: vi.fn(),
    onToggleReveal: vi.fn(async () => undefined),
    onEditItem: vi.fn(async () => undefined),
    onDeleteSecret: vi.fn(async () => undefined),
    onCopyToClipboard: vi.fn(async () => undefined),
    onCopySecret: vi.fn(async () => undefined),
    vault,
    titleAsHeader: true,
  })
}

describe('SecretDetailRow login card title', () => {
  test('uses the domain as the heading and the account as secondary text', () => {
    const view = renderLogin(
      loginItem('https://www.example.com/login', 'example.com'),
    )

    expect(view.getByTestId('secret-row-heading').textContent).toBe(
      'example.com',
    )
    expect(view.getByTestId('secret-row-account').textContent).toBe(
      'alice@example.com',
    )
  })

  test('localizes the heading when the login has no website', () => {
    const view = renderLogin(loginItem('', 'No Website'))

    expect(view.getByTestId('secret-row-heading').textContent).toBe(
      'Localized no website',
    )
  })
})
