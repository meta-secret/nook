import { fireEvent, render } from '@testing-library/svelte'
import { expect, test, vi } from 'vitest'
import { DeviceProtectionStatus } from '$app-wasm'
import { FirstRunPlace, FirstRunStage } from '$lib/vault/state/ui.svelte'
import FirstRunNameStep from '$lib/components/login/FirstRunNameStep.svelte'
import FirstRunStorageStep from '$lib/components/login/FirstRunStorageStep.svelte'
import FirstRunSyncStep from '$lib/components/login/FirstRunSyncStep.svelte'
import { VaultStateTestFixture } from '../vault-state-test-fixture'
import en from '../../../../../nook-platform/nook-app-common/locales/en.json' with { type: 'json' }

function storageChoice() {
  const vault = VaultStateTestFixture.create()
  vault.translations = JSON.stringify(en)
  vault.firstRun = FirstRunStage.Storage
  return vault
}

test.each([
  [DeviceProtectionStatus.Passkey, en.first_run.passkey_ready],
  [DeviceProtectionStatus.Pin, en.first_run.protection_ready],
] as const)(
  'acknowledges the unlocked protection method %s',
  (method, expected) => {
    const vault = storageChoice()
    vault.deviceProtectionStatus = DeviceProtectionStatus.Unlocked
    vault.deviceProtectionLockedStatus = method
    const view = render(FirstRunStorageStep, { vault })
    expect(view.getByTestId('first-run-milestone').textContent?.trim()).toBe(
      expected,
    )
  },
)

test('local storage goes straight to naming and Back returns to the undecided storage choice', async () => {
  const vault = storageChoice()
  const beginProvider = vi.spyOn(vault, 'beginProviderSetup')
  const choice = render(FirstRunStorageStep, { vault })
  expect(choice.queryByTestId('first-run-milestone')).toBeNull()
  expect(choice.queryByTestId('first-run-providers')).toBeNull()
  await fireEvent.click(
    choice.getByRole('button', { name: en.first_run.keep_local }),
  )
  expect(vault.firstRun).toBe(FirstRunStage.Name)
  expect(vault.firstRunPlace).toBe(FirstRunPlace.ThisBrowser)
  choice.unmount()

  const naming = render(FirstRunNameStep, { vault })
  expect(naming.getByTestId('first-run-milestone').textContent?.trim()).toBe(
    en.first_run.name_on_browser,
  )
  await fireEvent.click(naming.getByTestId('first-run-name-back'))
  expect(vault.firstRun).toBe(FirstRunStage.Storage)
  expect(vault.providerDraft.type).toBe('local')
  expect(beginProvider).not.toHaveBeenCalled()
})

test('sync reveals the providers on request, and Back clears the staged provider', async () => {
  const vault = storageChoice()
  const choice = render(FirstRunStorageStep, { vault })
  await fireEvent.click(
    choice.getByRole('button', { name: en.first_run.choose_sync }),
  )
  expect(vault.firstRun).toBe(FirstRunStage.Sync)
  choice.unmount()

  const provider = render(FirstRunSyncStep, { vault })
  expect(provider.getByTestId('first-run-providers')).toBeTruthy()
  expect(provider.getByTestId('first-run-google-sign-in')).toBeTruthy()
  await fireEvent.click(provider.getByTestId('first-run-s3-option'))
  expect(provider.getByTestId('first-run-s3-setup')).toBeTruthy()
  await fireEvent.click(provider.getByTestId('first-run-sync-back'))
  expect(vault.firstRun).toBe(FirstRunStage.Storage)
  expect(vault.providerDraft.type).toBe('local')
})
