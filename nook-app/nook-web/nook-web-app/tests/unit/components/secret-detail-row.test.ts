import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import { describe, expect, test, vi } from 'vitest'
import { render } from '@testing-library/svelte'
import { SecretType, type NookSecretListItem } from '$lib/nook'
import { VaultStateTestFixture } from '../vault-state-test-fixture'
import SecretDetailRow from '$lib/components/SecretDetailRow.svelte'
import {
  SecretRevealKind,
  type SecretReveal,
} from '$lib/components/secret-vault-state'
import { ok } from 'neverthrow'
import { SecretComponentTestFixture } from './secret-component-test-fixture'

const vault = VaultStateTestFixture.create()
vi.spyOn(vault, 't').mockImplementation((request) =>
  (typeof request === 'string' ? request : request.key) ===
  I18N_KEYS.VaultFieldsNoWebsite
    ? 'Localized no website'
    : typeof request === 'string'
      ? request
      : request.key,
)

const authenticatorItem = SecretComponentTestFixture.listItem({
  id: 'legacy-authenticator',
  type: SecretType.Authenticator,
  issuer: 'Legacy service',
  account: 'alice@example.com',
  backupCodeCount: 2,
})

const decryptedAuthenticator = SecretComponentTestFixture.record({
  totpSecret: 'JBSWY3DPEHPK3PXP',
  algorithm: 'SHA1',
  digits: 6,
  period: 30,
  backupCodes: ['recovery-one', 'recovery-two'],
})

function authenticatorProps(
  reveal: SecretReveal = { kind: SecretRevealKind.Hidden },
) {
  return {
    item: authenticatorItem,
    index: 0,
    expanded: true,
    reveal,
    onToggleExpand: vi.fn(),
    onToggleReveal: vi.fn(async () => {}),
    onEditItem: vi.fn(async () => {}),
    onDeleteSecret: vi.fn(async () => ok()),
    onCopyToClipboard: vi.fn(async () => {}),
    onCopySecret: vi.fn(async () => {}),
    vault,
  }
}

function loginItem(
  websiteUrl: string,
  websiteHost: string,
  username = 'alice@example.com',
): NookSecretListItem {
  return SecretComponentTestFixture.listItem({
    id: 'secret_login',
    type: SecretType.Login,
    displayTitle: websiteUrl,
    groupKey: websiteHost || 'No Website',
    summary: username || websiteUrl,
    websiteUrl,
    websiteHost,
    username,
  })
}

function renderLogin(item: NookSecretListItem) {
  return render(SecretDetailRow, {
    item,
    index: 0,
    expanded: false,
    onToggleExpand: vi.fn(),
    onToggleReveal: vi.fn(async () => {}),
    onEditItem: vi.fn(async () => {}),
    onDeleteSecret: vi.fn(async () => ok()),
    onCopyToClipboard: vi.fn(async () => {}),
    onCopySecret: vi.fn(async () => {}),
    vault,
    titleAsHeader: true,
  })
}

describe('SecretDetailRow authenticator recovery codes', () => {
  test('keeps legacy recovery codes masked until reveal, then displays them', async () => {
    const view = render(SecretDetailRow, authenticatorProps())

    expect(
      view.getByTestId('authenticator-backup-codes').textContent,
    ).toContain('••••••••')
    expect(view.queryByText('recovery-one')).not.toBeTruthy()

    await view.rerender(
      authenticatorProps({
        kind: SecretRevealKind.Revealed,
        record: decryptedAuthenticator,
      }),
    )

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
