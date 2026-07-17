import { describe, expect, test, vi } from 'vitest'
import { render } from '@testing-library/svelte'
import type { NookSecretListItem, NookSecretRecord } from '$lib/nook'
import type { VaultState } from '$lib/vault.svelte'
import SecretDetailRow from '$lib/components/SecretDetailRow.svelte'

const vault = {
  t(key: string): string {
    return key === 'vault.fields.no_website' ? 'Localized no website' : key
  },
} as unknown as VaultState

const authenticatorItem = {
  id: 'legacy-authenticator',
  type: 'authenticator',
  issuer: 'Legacy service',
  account: 'alice@example.com',
  backupCodeCount: 2,
} as unknown as NookSecretListItem

const decryptedAuthenticator = {
  ...authenticatorItem,
  totpSecret: 'JBSWY3DPEHPK3PXP',
  algorithm: 'SHA1',
  digits: 6,
  period: 30,
  backupCodes: ['recovery-one', 'recovery-two'],
} as unknown as NookSecretRecord

function authenticatorProps(revealed: NookSecretRecord | undefined) {
  return {
    item: authenticatorItem,
    index: 0,
    expanded: true,
    decrypted: revealed,
    copiedKey: undefined,
    onToggleExpand: vi.fn(),
    onToggleReveal: vi.fn(async () => undefined),
    onEditItem: vi.fn(async () => undefined),
    onDeleteSecret: vi.fn(async () => undefined),
    onCopyToClipboard: vi.fn(async () => undefined),
    onCopySecret: vi.fn(async () => undefined),
    vault,
  }
}

function loginItem(
  websiteUrl: string,
  websiteHost: string,
  username = 'alice@example.com',
): NookSecretListItem {
  return {
    id: 'secret_login',
    type: 'login',
    displayTitle: websiteUrl,
    groupKey: websiteHost || 'No Website',
    summary: username || websiteUrl,
    websiteUrl,
    websiteHost,
    username,
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

describe('SecretDetailRow authenticator recovery codes', () => {
  test('keeps legacy recovery codes masked until reveal, then displays them', async () => {
    const view = render(SecretDetailRow, authenticatorProps(undefined))

    expect(
      view.getByTestId('authenticator-backup-codes').textContent,
    ).toContain('••••••••')
    expect(view.queryByText('recovery-one')).not.toBeTruthy()

    await view.rerender(authenticatorProps(decryptedAuthenticator))

    expect(view.getByText('recovery-one')).toBeTruthy()
    expect(view.getByText('recovery-two')).toBeTruthy()
  })
})

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
    const view = renderLogin(loginItem('', ''))

    expect(view.getByTestId('secret-row-heading').textContent).toBe(
      'Localized no website',
    )
  })

  test('localizes the heading when a non-empty website has no host', () => {
    const view = renderLogin(loginItem('https://', ''))

    expect(view.getByTestId('secret-row-heading').textContent).toBe(
      'Localized no website',
    )
  })

  test('omits the account subtitle when the username is empty', () => {
    const view = renderLogin(
      loginItem('https://example.com', 'example.com', ''),
    )

    expect(view.queryByTestId('secret-row-account')).not.toBeTruthy()
  })
})
