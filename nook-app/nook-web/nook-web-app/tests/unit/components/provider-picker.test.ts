import { render } from '@testing-library/svelte'
import type { ComponentProps } from 'svelte'
import { afterEach, describe, expect, onTestFinished, test, vi } from 'vitest'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import { VaultStateTestFixture } from '../vault-state-test-fixture'
import ProviderPicker from '../../../../nook-web-shared/src/vault-app/lib/components/ProviderPicker.svelte'

afterEach(() => vi.restoreAllMocks())

function renderWithoutFolderAccess() {
  const vault = VaultStateTestFixture.create()
  vi.spyOn(vault, 't').mockImplementation((request) =>
    typeof request === 'string' ? request : request.key,
  )
  vault.localFolderBackupSupported = false
  const props = {
    vault,
    onSelect: vi.fn(),
  } satisfies ComponentProps<typeof ProviderPicker>
  return render(ProviderPicker, props)
}

describe('provider picker', () => {
  test('says local backup needs folder access when the browser lacks it', () => {
    const view = renderWithoutFolderAccess()

    const option = view.getByTestId('provider-option-local-folder')
    expect(option.hasAttribute('disabled')).toBe(true)
    expect(
      view.getByTestId('provider-option-local-folder-desc').textContent?.trim(),
    ).toBe(I18N_KEYS.ProviderPickerLocalFolderUnavailableDesc)
  })

  test('tells Brave users where to turn folder access on', () => {
    const brave: PropertyDescriptor = {
      configurable: true,
      value: { isBrave: async () => true },
    }
    Object.defineProperty(navigator, 'brave', brave)
    onTestFinished(() => {
      Reflect.deleteProperty(navigator, 'brave')
    })
    const view = renderWithoutFolderAccess()

    const description = view.getByTestId('provider-option-local-folder-desc')
    expect(description.textContent?.trim()).toBe(
      I18N_KEYS.ProviderPickerLocalFolderUnavailableBrave,
    )
    expect(description.getAttribute('title')).toBe(
      I18N_KEYS.ProviderPickerLocalFolderUnavailableBrave,
    )
  })
})
