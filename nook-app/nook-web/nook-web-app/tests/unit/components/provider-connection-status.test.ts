import { render } from '@testing-library/svelte'
import type { ComponentProps } from 'svelte'
import { describe, expect, test } from 'vitest'
import { VaultStateTestFixture } from '../vault-state-test-fixture'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import {
  ProviderConnectionPhase,
  ProviderConnectionProgress,
} from '$lib/vault/provider-connection-progress'
import ProviderConnectionStatus from '../../../../nook-web-shared/src/vault-app/lib/components/ProviderConnectionStatus.svelte'

function renderPhase(phase: ProviderConnectionPhase) {
  const vault = VaultStateTestFixture.create()
  const props = {
    vault,
    progress: new ProviderConnectionProgress(phase),
  } satisfies ComponentProps<typeof ProviderConnectionStatus>
  return { vault, view: render(ProviderConnectionStatus, props) }
}

describe('provider connection status', () => {
  test('names the running step, marks earlier ones done, and asks to wait', () => {
    const { vault, view } = renderPhase(ProviderConnectionPhase.Uploading)

    const status = view.getByRole('status')
    expect(status.getAttribute('aria-busy')).toBe('true')
    expect(status.dataset.phase).toBe(ProviderConnectionPhase.Uploading)
    expect(status.textContent).toContain(
      vault.t(I18N_KEYS.AuthStorageConnectProgressUploadingTitle),
    )
    expect(status.textContent).toContain(
      vault.t(I18N_KEYS.AuthStorageConnectProgressHint),
    )
    const steps = view.getByTestId('provider-connection-steps')
    const current = steps.querySelector('[aria-current="step"]')
    expect(current?.textContent).toContain(
      vault.t(I18N_KEYS.AuthStorageConnectProgressUploading),
    )
    expect(steps.querySelectorAll('li')).toHaveLength(4)
  })

  test('renders nothing while no connection runs', () => {
    const { view } = renderPhase(ProviderConnectionPhase.Idle)

    expect(view.queryAllByTestId('provider-connection-progress')).toHaveLength(
      0,
    )
  })
})
