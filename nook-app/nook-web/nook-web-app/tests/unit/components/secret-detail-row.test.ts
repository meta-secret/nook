import { describe, expect, test, vi } from 'vitest'
import { render } from '@testing-library/svelte'
import type { NookSecretListItem, NookSecretRecord } from '$lib/nook'
import type { VaultState } from '$lib/vault.svelte'
import SecretDetailRow from '$lib/components/SecretDetailRow.svelte'

const vault = {
  t(key: string): string {
    return key
  },
} as unknown as VaultState

const item = {
  id: 'legacy-authenticator',
  type: 'authenticator',
  issuer: 'Legacy service',
  account: 'alice@example.com',
  backupCodeCount: 2,
} as unknown as NookSecretListItem

const decrypted = {
  ...item,
  totpSecret: 'JBSWY3DPEHPK3PXP',
  algorithm: 'SHA1',
  digits: 6,
  period: 30,
  backupCodes: ['recovery-one', 'recovery-two'],
} as unknown as NookSecretRecord

function props(revealed: NookSecretRecord | undefined) {
  return {
    item,
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

describe('SecretDetailRow authenticator recovery codes', () => {
  test('keeps legacy recovery codes masked until reveal, then displays them', async () => {
    const view = render(SecretDetailRow, props(undefined))

    expect(
      view.getByTestId('authenticator-backup-codes').textContent,
    ).toContain('••••••••')
    expect(view.queryByText('recovery-one')).not.toBeTruthy()

    await view.rerender(props(decrypted))

    expect(view.getByText('recovery-one')).toBeTruthy()
    expect(view.getByText('recovery-two')).toBeTruthy()
  })
})
