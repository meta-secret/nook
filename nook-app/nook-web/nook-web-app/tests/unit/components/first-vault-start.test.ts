import { fireEvent, render, within } from '@testing-library/svelte'
import { expect, test, vi } from 'vitest'
import enLocale from '../../../../../nook-platform/nook-app-common/locales/en.json' with { type: 'json' }
import ruLocale from '../../../../../nook-platform/nook-app-common/locales/ru.json' with { type: 'json' }
import { FirstRunStage } from '$lib/vault/state/ui.svelte'
import FirstVaultStart from '$lib/components/login/FirstVaultStart.svelte'
import { VaultStateTestFixture } from '../vault-state-test-fixture'

test.each([enLocale, ruLocale])(
  'shows the local-first ownership hierarchy and optional cloud sync',
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

    const start = view.getByTestId('first-vault-start')
    expect(start.textContent).not.toMatch(/keyring/i)
    expect(start.textContent).not.toMatch(/связк/i)

    expect(view.getByText(locale.first_run.eyebrow)).toBeTruthy()
    expect(
      view.getByRole('heading', { level: 1, name: locale.first_run.title }),
    ).toBeTruthy()
    expect(view.getByText(locale.first_run.intro)).toBeTruthy()
    const createButton = view.getByRole('button', {
      name: locale.first_run.create,
      description: locale.first_run.create_hint,
    })
    expect(createButton).toBeTruthy()

    const returning = within(
      view.getByRole('region', { name: locale.first_run.returning }),
    )
    expect(returning.getAllByRole('button')).toEqual([
      returning.getByRole('button', {
        name: locale.first_run.path_recover,
        description: locale.first_run.backup_access,
      }),
    ])
    expect(
      returning.getByTestId('return-route-destination').textContent,
    ).toContain(locale.join.this_device)

    const labels = locale.first_run.local_first
    const dataPath = view.getByRole('figure', {
      name: labels.diagram_description,
    })
    expect(view.getAllByRole('figure')).toEqual([dataPath])

    const passkey = within(dataPath).getByTestId('local-vault-passkey')
    expect(within(passkey).getByText(labels.passkey)).toBeTruthy()
    expect(within(passkey).getByText(labels.passkey_detail)).toBeTruthy()
    expect(within(dataPath).getByText(labels.unlocks)).toBeTruthy()

    const device = within(dataPath).getByTestId('local-vault-browser')
    expect(within(device).getByText(labels.browser)).toBeTruthy()
    expect(within(device).getByText(labels.ownership_tag)).toBeTruthy()
    expect(within(device).getByText(labels.vault)).toBeTruthy()
    expect(within(device).getByText(labels.items_passwords)).toBeTruthy()
    expect(within(device).getByText(labels.items_totp)).toBeTruthy()
    expect(within(device).getByText(labels.items_secrets)).toBeTruthy()
    expect(within(device).getByText(labels.zero_server)).toBeTruthy()
    expect(within(device).queryAllByText(labels.storage)).toHaveLength(0)

    expect(within(dataPath).getByText(labels.optional_sync)).toBeTruthy()
    const cloud = within(dataPath).getByTestId('local-vault-cloud')
    expect(within(cloud).getByText(labels.storage)).toBeTruthy()
    expect(within(cloud).getByText(labels.storage_detail)).toBeTruthy()

    expect(
      view.getByRole('button', { name: locale.first_run.how_it_works }),
    ).toBeTruthy()
    expect(
      view.getByRole('button', { name: locale.first_run.path_check }),
    ).toBeTruthy()

    expect(onCreate).not.toHaveBeenCalled()
    expect(onConnectStorage).not.toHaveBeenCalled()
    await fireEvent.click(
      view.getByRole('button', { name: locale.first_run.path_recover }),
    )
    expect(onConnectStorage).toHaveBeenCalledOnce()
    await fireEvent.click(createButton)
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
    expect(
      view.getByTestId('first-run-create-identity-btn').matches(':disabled'),
    ).toBe(true)
    expect(invite().matches(':disabled')).toBe(true)
    expect(backup().matches(':disabled')).toBe(true)
  },
)
