import { describe, expect, test, vi } from 'vitest'
import { fireEvent, render, waitFor } from '@testing-library/svelte'
import {
  SecretType,
  type NookSecretRecord,
  type PasswordGenerationOptions,
} from '$lib/nook'
import type { VaultState } from '$lib/vault.svelte'
import AddSecretForm from '$lib/components/AddSecretForm.svelte'
import { SecretTypeSelectionKind } from '$lib/components/secret-form-state'
import { SecretEditorKind } from '$lib/components/secret-vault-state'

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
  type: SecretType.Authenticator,
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
    .fn<
      (request: {
        readonly oldId: string
        readonly type: SecretType
        readonly data: string
      }) => Promise<void>
    >()
    .mockResolvedValue()
  const view = render(AddSecretForm, {
    vault,
    isSaving: false,
    onAddSecret: vi.fn(async () => {}),
    onReplaceSecret,
    onGeneratePassword: vi.fn(() => ''),
    onCancel: vi.fn(),
    editor: {
      kind: SecretEditorKind.Editing,
      record: legacyAuthenticator,
    },
    selectedTypeState: {
      kind: SecretTypeSelectionKind.EditingFields,
      itemType: SecretType.Authenticator,
    },
  })
  return { onReplaceSecret, view }
}

describe('AddSecretForm file attachment picker', () => {
  test('shows the file attachment type in the item picker', async () => {
    const view = render(AddSecretForm, {
      vault,
      isSaving: false,
      onAddSecret: vi.fn(async () => {}),
      onGeneratePassword: vi.fn(() => ''),
      onCancel: vi.fn(),
    })

    expect(view.getByTestId('item-type-file-attachment')).toBeTruthy()
    await fireEvent.click(view.getByTestId('item-type-file-attachment'))
    expect(await view.findByTestId('file-attachment-input')).toBeTruthy()
    expect(view.getByTestId('file-attachment-title')).toBeTruthy()
  })
})

describe('AddSecretForm password generation', () => {
  test('passes the Rust-owned default option contract to password generation', async () => {
    const onGeneratePassword = vi
      .fn<(options: PasswordGenerationOptions) => string>()
      .mockReturnValue('rust-generated-password')
    const view = render(AddSecretForm, {
      vault,
      isSaving: false,
      onAddSecret: vi.fn(async () => {}),
      onGeneratePassword,
      onCancel: vi.fn(),
    })

    await fireEvent.click(view.getByTestId('item-type-login'))
    await fireEvent.click(view.getByTestId('password-generator-toggle'))
    await fireEvent.click(view.getByTestId('generate-password-btn'))

    expect(onGeneratePassword).toHaveBeenCalledWith({
      length: 20,
      lowercase: true,
      uppercase: true,
      numbers: true,
      symbols: true,
    })
    expect((view.getByTestId('secret-value') as HTMLInputElement).value).toBe(
      'rust-generated-password',
    )
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
    const request = onReplaceSecret.mock.calls[0][0]
    expect(request.type).toBe(SecretType.Authenticator)
    expect(request.data).toContain('algorithm: SHA256')
    expect(request.data).toContain('digits: 8')
    expect(request.data).toContain('period: 45')
    expect(request.data).toContain('recovery-one')
    expect(request.data).toContain('recovery-two')
  })

  test('resets hidden protocol settings and recovery codes when the setup key changes', async () => {
    const { onReplaceSecret, view } = renderLegacyAuthenticatorEditor()

    const setupKey = await view.findByTestId('authenticator-secret')
    await fireEvent.input(setupKey, {
      target: { value: 'KRUGS4ZANFZSAYJA' },
    })
    await fireEvent.click(view.getByTestId('save-secret-btn'))

    await waitFor(() => expect(onReplaceSecret).toHaveBeenCalledTimes(1))
    const request = onReplaceSecret.mock.calls[0][0]
    expect(request.type).toBe(SecretType.Authenticator)
    expect(request.data).toContain('algorithm: SHA1')
    expect(request.data).toContain('digits: 6')
    expect(request.data).toContain('period: 30')
    expect(request.data).not.toContain('recovery-one')
    expect(request.data).not.toContain('recovery-two')
  })
})
