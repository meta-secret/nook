import { fireEvent, render } from '@testing-library/svelte'
import type { ComponentProps } from 'svelte'
import { afterEach, describe, expect, onTestFinished, test, vi } from 'vitest'
import { ReplicationType } from '$app-wasm'
import { S3_PROVIDER_TYPE } from '$lib/auth/providers'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import { VaultStateTestFixture } from '../vault-state-test-fixture'
import ProviderPicker from '../../../../nook-web-shared/src/vault-app/lib/components/ProviderPicker.svelte'
import { requireButtonElement } from '../test-dom-helpers'

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

/** The picker with translation keys as its text, for a vault replicated
 * one way or the other. */
function renderFor(replication: ReplicationType) {
  const vault = VaultStateTestFixture.create()
  vi.spyOn(vault, 't').mockImplementation((request) =>
    typeof request === 'string' ? request : request.key,
  )
  vault.draftReplicationType = replication
  const onSelect = vi.fn<ComponentProps<typeof ProviderPicker>['onSelect']>()
  const props = {
    vault,
    onSelect,
  } satisfies ComponentProps<typeof ProviderPicker>
  return { view: render(ProviderPicker, props), onSelect }
}

describe('provider picker', () => {
  test('offers S3-compatible storage last, and picking it sets S3 up', async () => {
    const { view, onSelect } = renderFor(ReplicationType.Personal)

    const options = view.getAllByRole('button')
    const s3 = view.getByTestId('provider-option-s3')
    expect(options.at(-1)).toBe(s3)
    expect(s3.textContent).toContain(I18N_KEYS.ProviderPickerS3)
    expect(s3.textContent).toContain(I18N_KEYS.ProviderPickerS3Desc)

    await fireEvent.click(s3)

    expect(onSelect).toHaveBeenCalledWith({ type: S3_PROVIDER_TYPE })
  })

  test('a vault shared with other accounts cannot use S3, as with GitHub', () => {
    const { view } = renderFor(ReplicationType.Shared)

    for (const testId of ['provider-option-s3', 'provider-option-github']) {
      const option = requireButtonElement(view.getByTestId(testId))
      expect(option.disabled).toBe(true)
      expect(option.textContent).toContain(
        I18N_KEYS.ProviderPickerUnsupportedReplicationDesc,
      )
    }
  })

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
