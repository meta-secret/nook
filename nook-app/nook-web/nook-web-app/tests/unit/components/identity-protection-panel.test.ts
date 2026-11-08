import { fireEvent, render } from '@testing-library/svelte'
import type { ComponentProps } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import {
  assess_identity_health,
  NookBrowserExtensionInstallation,
  NookBrowserExtensionMembership,
  NookIdentityNextStep,
  type NookIdentityHealth,
} from '$app-wasm'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import { VaultStateTestFixture } from '../vault-state-test-fixture'
import IdentityProtectionPanel from '../../../../nook-web-shared/src/vault-app/lib/components/identities/IdentityProtectionPanel.svelte'

type PanelProps = ComponentProps<typeof IdentityProtectionPanel>

const NOT_OFFERED = NookBrowserExtensionInstallation.NotOffered
const NOT_JOINED = NookBrowserExtensionMembership.NotJoined

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
    const view = renderPanel(assess_identity_health(0, 0, 1, 3, NOT_OFFERED, NOT_JOINED))

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
    const view = renderPanel(assess_identity_health(1, 1, 1, 3, NOT_OFFERED, NOT_JOINED))

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
    const view = renderPanel(assess_identity_health(1, 0, 1, 3, NOT_OFFERED, NOT_JOINED))

    expect(
      view.getByTestId('identity-protection-action').textContent,
    ).toContain(view.vault.t(I18N_KEYS.IdentityProtectionActionAddCloud))
    expect(
      view.queryAllByTestId('identity-protection-add-another'),
    ).toHaveLength(0)
  })

  test('a kept copy offers another provider quietly until a second device joins', async () => {
    const view = renderPanel(assess_identity_health(1, 1, 1, 3, NOT_OFFERED, NOT_JOINED))

    const another = view.getByTestId('identity-protection-add-another')
    expect(another.textContent).toContain(
      view.vault.t(I18N_KEYS.IdentityProtectionActionAddAnotherSync),
    )
    await fireEvent.click(another)
    expect(view.onAction).toHaveBeenCalledWith(
      NookIdentityNextStep.AddSyncProvider,
    )

    view.unmount()
    const protectedView = renderPanel(assess_identity_health(1, 1, 2, 3, NOT_OFFERED, NOT_JOINED))
    expect(
      protectedView.queryAllByTestId('identity-protection-add-another'),
    ).toHaveLength(0)
  })

  test('the browser extension comes last and waits quietly behind the lead step', async () => {
    const view = renderPanel(
      assess_identity_health(
        0,
        0,
        1,
        3,
        NookBrowserExtensionInstallation.NotInstalled,
        NOT_JOINED,
      ),
    )

    const steps = view.getAllByTestId('identity-protection-step')
    expect(steps.map((step) => step.dataset.task)).toEqual([
      'copy',
      'device',
      'extension',
    ])
    expect(steps.map((step) => step.dataset.state)).toEqual([
      'open',
      'blocked',
      'open',
    ])
    // One lead on the journey: the copy. The extension is offered quietly.
    expect(view.getAllByTestId('identity-protection-action')).toHaveLength(1)
    expect(steps[0]?.getAttribute('aria-current')).toBe('step')
    const install = view.getByTestId('identity-protection-later-action')
    expect(install.textContent).toContain(
      view.vault.t(I18N_KEYS.IdentityProtectionActionInstallExtension),
    )
    await fireEvent.click(install)
    expect(view.onAction).toHaveBeenCalledWith(
      NookIdentityNextStep.InstallExtension,
    )
  })

  test('once protected, an installed extension leads with Connect and names no risk', async () => {
    const view = renderPanel(
      assess_identity_health(
        1,
        1,
        2,
        3,
        NookBrowserExtensionInstallation.Installed,
        NOT_JOINED,
      ),
    )

    expect(view.queryAllByTestId('identity-protection-risk')).toHaveLength(0)
    const steps = view.getAllByTestId('identity-protection-step')
    expect(steps.map((step) => step.dataset.state)).toEqual([
      'done',
      'done',
      'open',
    ])
    expect(steps[2]?.textContent).toContain(
      view.vault.t(I18N_KEYS.IdentityProtectionExtensionConnectWhy),
    )
    const connect = view.getByTestId('identity-protection-action')
    expect(connect.textContent).toContain(
      view.vault.t(I18N_KEYS.IdentityProtectionActionConnectExtension),
    )
    await fireEvent.click(connect)
    expect(view.onAction).toHaveBeenCalledWith(
      NookIdentityNextStep.ConnectExtension,
    )
  })
})
