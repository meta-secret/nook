import { describe, expect, test, vi } from 'vitest'
import { fireEvent, render, waitFor } from '@testing-library/svelte'
import type { NookSecretRecord, VaultItemType } from '$lib/nook'
import type { VaultState } from '$lib/vault.svelte'
import AddSecretForm from '$lib/components/AddSecretForm.svelte'

const vault = {
  t(key: string): string {
    return key
  },
  resolveErrorMessage(error: string): string {
    return error
  },
} as unknown as VaultState

const legacyAuthenticator = {
  id: 'legacy-authenticator',
  type: 'authenticator',
  issuer: 'Legacy service',
  account: 'alice@example.com',
  websiteUrl: '',
  totpSecret: 'JBSWY3DPEHPK3PXP',
  algorithm: 'SHA256',
  digits: 8,
  period: 45,
  backupCodes: ['recovery-one', 'recovery-two'],
} as unknown as NookSecretRecord

function renderLegacyAuthenticatorEditor() {
  const onReplaceSecret = vi
    .fn<(oldId: string, type: VaultItemType, data: string) => Promise<void>>()
    .mockResolvedValue(undefined)
  const view = render(AddSecretForm, {
    vault,
    isSaving: false,
    onAddSecret: vi.fn(async () => undefined),
    onReplaceSecret,
    onGeneratePassword: vi.fn(() => ''),
    onCancel: vi.fn(),
    initialItem: legacyAuthenticator,
    selectedType: 'authenticator',
  })
  return { onReplaceSecret, view }
}

describe('AddSecretForm file attachment picker', () => {
  test('shows the file attachment type in the item picker', async () => {
    const view = render(AddSecretForm, {
      vault,
      isSaving: false,
      onAddSecret: vi.fn(async () => undefined),
      onGeneratePassword: vi.fn(() => ''),
      onCancel: vi.fn(),
    })

    expect(view.getByTestId('item-type-file-attachment')).toBeTruthy()
    await fireEvent.click(view.getByTestId('item-type-file-attachment'))
    expect(await view.findByTestId('file-attachment-input')).toBeTruthy()
    expect(view.getByTestId('file-attachment-title')).toBeTruthy()
  })
})

describe('AddSecretForm authenticator editing', () => {
  test('preserves hidden settings when only setup-key formatting changes', async () => {
    const { onReplaceSecret, view } = renderLegacyAuthenticatorEditor()

    const setupKey = await view.findByTestId('authenticator-secret')
    await fireEvent.input(setupKey, {
      target: { value: 'jbsw-y3dp ehpk-3pxp====' },
    })
    await fireEvent.click(view.getByTestId('save-secret-btn'))

    await waitFor(() => expect(onReplaceSecret).toHaveBeenCalledTimes(1))
    const [, type, yaml] = onReplaceSecret.mock.calls[0]
    expect(type).toBe('authenticator')
    expect(yaml).toContain('algorithm: SHA256')
    expect(yaml).toContain('digits: 8')
    expect(yaml).toContain('period: 45')
    expect(yaml).toContain('recovery-one')
    expect(yaml).toContain('recovery-two')
  })

  test('resets hidden protocol settings and recovery codes when the setup key changes', async () => {
    const { onReplaceSecret, view } = renderLegacyAuthenticatorEditor()

    const setupKey = await view.findByTestId('authenticator-secret')
    await fireEvent.input(setupKey, {
      target: { value: 'KRUGS4ZANFZSAYJA' },
    })
    await fireEvent.click(view.getByTestId('save-secret-btn'))

    await waitFor(() => expect(onReplaceSecret).toHaveBeenCalledTimes(1))
    const [, type, yaml] = onReplaceSecret.mock.calls[0]
    expect(type).toBe('authenticator')
    expect(yaml).toContain('algorithm: SHA1')
    expect(yaml).toContain('digits: 6')
    expect(yaml).toContain('period: 30')
    expect(yaml).not.toContain('recovery-one')
    expect(yaml).not.toContain('recovery-two')
  })
})
