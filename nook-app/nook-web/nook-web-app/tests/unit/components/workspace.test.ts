import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/svelte'
import { ok } from 'neverthrow'
import { tick } from 'svelte'
import { SecretType } from '$lib/nook'
import {
  CompanionProviderPresence,
  VaultStartupUnlockDecision,
} from '$app-wasm'
import { extensionConnectionBrowser } from '$lib/extension/connect'
import CompanionAccess from '$lib/workspace/CompanionAccess.svelte'
import Items from '$lib/workspace/Items.svelte'
import ItemDetail from '$lib/workspace/ItemDetail.svelte'
import ItemEditor from '$lib/workspace/ItemEditor.svelte'
import Preferences from '$lib/workspace/Preferences.svelte'
import { SecretEditorKind } from '$lib/components/secret-vault-state'
import { SecretMutationOutcome } from '$lib/vault/secret-operation-failure'
import { I18N_KEYS as K } from '../../../../nook-web-shared/src/generated/i18n-keys'
import { VaultStateTestFixture } from '../vault-state-test-fixture'
import { SecretComponentTestFixture as Secrets } from './secret-component-test-fixture'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
function fixture() {
  const vault = VaultStateTestFixture.create()
  vault.isInitializing = false
  vault.isAuthenticated = true
  return vault
}

describe('replacement workspace', () => {
  test('allows explicit companion unlock while background discovery is pending', async () => {
    const vault = fixture()
    vault.isAuthenticated = false
    vi.spyOn(vault, 'shouldAutoUnlock').mockReturnValue(true)
    vi.spyOn(vault, 'startupUnlockDecision').mockReturnValue(
      VaultStartupUnlockDecision.DiscoverCompanion,
    )
    vi.spyOn(
      extensionConnectionBrowser,
      'companionProviderPresence',
    ).mockReturnValue(CompanionProviderPresence.Present)
    vi.spyOn(
      extensionConnectionBrowser,
      'discoverAdmittedPairedExtensionIdentity',
    ).mockImplementation(() => new Promise(() => {}))
    const view = render(CompanionAccess, {
      vault,
      storeId: 'store_abcdefghijk',
    })
    await tick()
    expect(view.getByTestId('unlock-vault-btn').hasAttribute('disabled')).toBe(
      false,
    )
    view.unmount()
  })
  test('never offers plaintext exposure for a managed passkey', () => {
    const vault = fixture()
    const decrypt = vi.spyOn(vault, 'decryptSecret')
    const view = render(ItemDetail, {
      vault,
      item: Secrets.listItem({
        type: SecretType.Passkey,
        displayTitle: 'Example passkey',
      }),
      close: vi.fn(),
    })
    expect(
      view.queryByRole('button', { name: vault.t(K.VaultShowValue) }),
    ).toBeFalsy()
    expect(
      view.queryByRole('button', { name: vault.t(K.CommonEdit) }),
    ).toBeFalsy()
    expect(decrypt).not.toHaveBeenCalled()
  })
  test('lists metadata without decrypting and opens only the selected item', async () => {
    const vault = fixture()
    vault.secrets = [
      Secrets.listItem({
        displayTitle: 'Personal email',
        summary: 'me@example.com',
      }),
    ]
    vault.secretTotal = 1
    const decrypt = vi.spyOn(vault, 'decryptSecret')
    const view = render(Items, { vault })
    expect(decrypt).not.toHaveBeenCalled()
    await fireEvent.click(view.getByRole('button', { name: /Personal email/ }))
    expect(view.getByRole('heading', { name: 'Personal email' })).toBeTruthy()
    expect(decrypt).not.toHaveBeenCalled()
  })
  test('releases a revealed record when navigating away', async () => {
    const vault = fixture()
    const record = Secrets.record({
      password: 'test-secret',
      displayTitle: 'Personal email',
    })
    vi.spyOn(vault, 'decryptSecret').mockResolvedValue(ok(record))
    const view = render(ItemDetail, {
      vault,
      item: Secrets.listItem({ displayTitle: 'Personal email' }),
      close: vi.fn(),
    })
    expect(view.queryByText('test-secret')).toBeFalsy()
    await fireEvent.click(
      view.getByRole('button', { name: vault.t(K.VaultShowValue) }),
    )
    expect(view.getByText('test-secret')).toBeTruthy()
    view.unmount()
    expect(record.free).toHaveBeenCalledOnce()
  })
  test('does not publish a late decryption after its detail pane is closed', async () => {
    const vault = fixture()
    const record = Secrets.record({ password: 'late-secret' })
    let finish!: (
      value: Awaited<ReturnType<typeof vault.decryptSecret>>,
    ) => void
    const pending = new Promise<
      Awaited<ReturnType<typeof vault.decryptSecret>>
    >((resolve) => {
      finish = resolve
    })
    vi.spyOn(vault, 'decryptSecret').mockReturnValue(pending)
    const view = render(ItemDetail, {
      vault,
      item: Secrets.listItem({ displayTitle: 'Personal email' }),
      close: vi.fn(),
    })
    await fireEvent.click(
      view.getByRole('button', { name: vault.t(K.VaultShowValue) }),
    )
    view.unmount()
    finish(ok(record))
    await tick()
    expect(record.free).toHaveBeenCalledOnce()
  })
  test('requires a separate confirmation before deleting an item', async () => {
    const vault = fixture()
    const remove = vi
      .spyOn(vault, 'handleDeleteSecret')
      .mockResolvedValue(ok(SecretMutationOutcome.Deleted))
    const close = vi.fn()
    const view = render(ItemDetail, {
      vault,
      item: Secrets.listItem({ displayTitle: 'Personal email' }),
      close,
    })
    await fireEvent.click(
      view.getByRole('button', { name: vault.t(K.CommonDelete) }),
    )
    expect(remove).not.toHaveBeenCalled()
    await fireEvent.click(
      view.getByRole('button', { name: vault.t(K.CommonCancel) }),
    )
    expect(remove).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
  })
  test('validates a new login through Rust before saving and closes only on success', async () => {
    const vault = fixture()
    const save = vi
      .spyOn(vault, 'handleAddSecret')
      .mockResolvedValue(ok(SecretMutationOutcome.Added))
    const close = vi.fn()
    const view = render(ItemEditor, {
      vault,
      editor: { kind: SecretEditorKind.Creating },
      close,
    })
    await fireEvent.input(
      view.getByLabelText(vault.t(K.VaultFieldsWebsiteLabel)),
      { target: { value: 'https://example.com' } },
    )
    await fireEvent.input(view.getByLabelText(vault.t(K.VaultFieldsUsername)), {
      target: { value: 'me' },
    })
    await fireEvent.input(view.getByLabelText(vault.t(K.VaultFieldsPassword)), {
      target: { value: 'test-password' },
    })
    const form = view
      .getByRole('button', { name: vault.t(K.CommonSave) })
      .closest('form')
    if (!form) throw new Error('Expected editor form')
    await fireEvent.submit(form)
    expect(save).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
  })
  test('requires local-data confirmation and preserves data on cancel', async () => {
    const vault = fixture()
    vi.spyOn(vault, 'refreshPasswordEntriesList').mockResolvedValue(
      ok({ entries: [] }),
    )
    const remove = vi.spyOn(vault, 'deleteLocalBrowserData').mockResolvedValue()
    const view = render(Preferences, { vault, toggleAppearance: vi.fn() })
    await fireEvent.click(
      view.getByRole('button', { name: vault.t(K.SettingsDeleteLocalButton) }),
    )
    expect(remove).not.toHaveBeenCalled()
    await fireEvent.click(
      view.getByRole('button', { name: vault.t(K.CommonCancel) }),
    )
    expect(remove).not.toHaveBeenCalled()
  })
})
