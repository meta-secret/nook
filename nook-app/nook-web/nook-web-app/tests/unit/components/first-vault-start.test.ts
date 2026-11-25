import { fireEvent, render, within } from '@testing-library/svelte'
import { expect, test, vi } from 'vitest'
import enLocale from '../../../../../nook-platform/nook-app-common/locales/en.json' with { type: 'json' }
import ruLocale from '../../../../../nook-platform/nook-app-common/locales/ru.json' with { type: 'json' }
import { FirstRunStage } from '$lib/vault/state/ui.svelte'
import FirstVaultStart from '$lib/components/login/FirstVaultStart.svelte'
import { VaultStateTestFixture } from '../vault-state-test-fixture'

test.each([enLocale, ruLocale])(
  'separates the vault data path from optional app hosting',
  async (locale) => {
    const vault = VaultStateTestFixture.create()
    vault.translations = JSON.stringify(locale)
    const onCreate = vi.fn()
    const onConnectStorage = vi.fn()
    const view = render(FirstVaultStart, {
      vault,
      isBusy: false,
      isVerifying: false,
      onCreate,
      onConnectStorage,
    })
    const labels = locale.first_run.local_first
    const dataPath = view.getByRole('figure', {
      name: labels.diagram_description,
    })
    const device = within(dataPath).getByTestId('local-vault-browser')
    expect(within(device).getByText(labels.vault)).toBeTruthy()
    expect(within(device).queryByText(labels.storage)).toBeNull()
    expect(within(dataPath).getByText(labels.optional_sync)).toBeTruthy()
    expect(within(dataPath).getByText(labels.storage)).toBeTruthy()

    const disclosure = view.getByText(labels.self_host)
    const details = disclosure.closest('details')
    expect(details?.open).toBe(false)
    await fireEvent.click(disclosure)
    expect(details?.open).toBe(true)
    expect(within(dataPath).queryByText(labels.server)).toBeNull()
    expect(view.getByText(labels.hosting_description)).toBeTruthy()
    expect(onCreate).not.toHaveBeenCalled()
    expect(onConnectStorage).not.toHaveBeenCalled()
    await fireEvent.click(
      view.getByRole('button', { name: locale.first_run.path_recover }),
    )
    expect(onConnectStorage).toHaveBeenCalledOnce()
    await fireEvent.click(
      view.getByRole('button', { name: locale.first_run.create }),
    )
    expect(onCreate).toHaveBeenCalledWith(locale.first_run.name_placeholder)
    expect(vault.firstRun).toBe(FirstRunStage.Protect)
  },
)
