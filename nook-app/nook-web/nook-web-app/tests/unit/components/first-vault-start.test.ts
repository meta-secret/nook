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
    const returning = within(
      view.getByRole('region', { name: locale.first_run.returning }),
    )
    expect(returning.getAllByRole('button')).toEqual([
      returning.getByRole('button', { name: locale.first_run.path_recover }),
    ])
    const labels = locale.first_run.local_first
    const dataPath = view.getByRole('figure', {
      name: labels.diagram_description,
    })
    const device = within(dataPath).getByTestId('local-vault-browser')
    expect(within(device).getByText(labels.vault)).toBeTruthy()
    expect(within(device).queryAllByText(labels.storage)).toHaveLength(0)
    expect(within(dataPath).getByText(labels.optional_sync)).toBeTruthy()
    expect(within(dataPath).getByText(labels.storage)).toBeTruthy()

    const disclosure = view.getByText(labels.self_host)
    const details = disclosure.closest('details')
    expect(details?.open).toBe(false)
    await fireEvent.click(disclosure)
    expect(details?.open).toBe(true)
    expect(within(dataPath).queryAllByText(labels.server)).toHaveLength(0)
    expect(
      view.getByRole('figure', { name: labels.hosting_description }),
    ).toBeTruthy()
    expect(view.queryAllByText(labels.hosting_description)).toHaveLength(0)
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

test.each([enLocale, ruLocale])(
  'opens the chosen return route and restores focus after leaving an invite',
  async (locale) => {
    const vault = VaultStateTestFixture.create()
    vault.translations = JSON.stringify(locale)
    const props = {
      vault,
      isBusy: false,
      isVerifying: false,
      onCreate: vi.fn(),
      onUseEnrollmentCode: vi.fn(),
      onConnectStorage: vi.fn(),
    }
    const view = render(FirstVaultStart, props)
    const routes = () =>
      within(view.getByRole('region', { name: locale.first_run.returning }))
    const invite = () =>
      routes().getByRole('button', {
        name: locale.first_run.path_add_device,
        description: locale.first_run.invite_source,
      })
    const backup = () =>
      routes().getByRole('button', {
        name: locale.first_run.path_recover,
        description: locale.first_run.backup_access,
      })

    expect(routes().getAllByRole('button')).toEqual([invite(), backup()])
    expect(props.onConnectStorage).not.toHaveBeenCalled()
    await fireEvent.click(invite())
    expect(view.getByRole('heading', { name: locale.join.title })).toBe(
      document.activeElement,
    )
    expect(props.onUseEnrollmentCode).not.toHaveBeenCalled()
    await fireEvent.click(view.getByTestId('join-back'))
    expect(invite()).toBe(document.activeElement)
    await fireEvent.click(backup())
    expect(props.onConnectStorage).toHaveBeenCalledOnce()
    expect(props.onCreate).not.toHaveBeenCalled()

    await view.rerender({ ...props, isBusy: true })
    expect(invite().matches(':disabled')).toBe(true)
    expect(backup().matches(':disabled')).toBe(true)
  },
)
