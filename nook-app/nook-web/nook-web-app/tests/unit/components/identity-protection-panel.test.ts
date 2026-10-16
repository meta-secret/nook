import { fireEvent, render } from '@testing-library/svelte'
import type { ComponentProps } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import {
  assess_identity_health,
  NookIdentityNextStep,
  type NookIdentityHealth,
} from '$app-wasm'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import { VaultStateTestFixture } from '../vault-state-test-fixture'
import IdentityProtectionPanel from '../../../../nook-web-shared/src/vault-app/lib/components/identities/IdentityProtectionPanel.svelte'

type PanelProps = ComponentProps<typeof IdentityProtectionPanel>

function renderPanel(health: NookIdentityHealth) {
  const vault = VaultStateTestFixture.create()
  const onAction = vi.fn()
  const props = {
    vault,
    health,
    identityName: 'Personal',
    onAction,
    onClose: vi.fn(),
  } satisfies PanelProps
  return { ...render(IdentityProtectionPanel, props), vault, onAction }
}

describe('identity protection checklist', () => {
  test('a browser-only identity names the risk and leads with a sync provider', async () => {
    const view = renderPanel(assess_identity_health(0, 0, 1, 3))

    expect(view.getByTestId('identity-protection-risk').textContent).toContain(
      view.vault.t(I18N_KEYS.IdentityProtectionRiskLocal),
    )
    const steps = view.getAllByTestId('identity-protection-step')
    expect(steps.map((step) => step.dataset.state)).toEqual(['open', 'blocked'])
    expect(view.getAllByTestId('identity-protection-action')).toHaveLength(1)
    const action = view.getByTestId('identity-protection-action')
    expect(action.textContent).toContain(
      view.vault.t(I18N_KEYS.IdentityProtectionActionAddSync),
    )

    await fireEvent.click(action)
    expect(view.onAction).toHaveBeenCalledWith(
      NookIdentityNextStep.AddSyncProvider,
    )
  })

  test('a kept copy stays ticked while the second device is offered', async () => {
    const view = renderPanel(assess_identity_health(1, 1, 1, 3))

    const steps = view.getAllByTestId('identity-protection-step')
    expect(steps.map((step) => step.dataset.state)).toEqual(['done', 'open'])
    expect(view.getByTestId('identity-protection-risk').textContent).toContain(
      view.vault.t(I18N_KEYS.IdentityProtectionRiskOneDevice),
    )
    const action = view.getByTestId('identity-protection-action')
    expect(action.textContent).toContain(
      view.vault.t(I18N_KEYS.IdentityProtectionActionAddDevice),
    )

    await fireEvent.click(action)
    expect(view.onAction).toHaveBeenCalledWith(NookIdentityNextStep.AddDevice)
  })

  test('a local-folder copy asks for a cloud provider before a device can join', () => {
    const view = renderPanel(assess_identity_health(1, 0, 1, 3))

    expect(
      view.getByTestId('identity-protection-action').textContent,
    ).toContain(view.vault.t(I18N_KEYS.IdentityProtectionActionAddCloud))
  })
})
