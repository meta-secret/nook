import { afterEach, describe, expect, test, vi } from 'vitest'
import { NookIdentityNextStep } from '$app-wasm'
import { extensionSetupBrowser } from '$lib/app/extension-setup'
import { takeProtectionStep } from '$lib/components/identities/protection-step'
import { WorkspaceSection } from '$lib/vault/state/ui.svelte'
import { VaultStateTestFixture } from '../vault-state-test-fixture'

afterEach(() => {
  vi.restoreAllMocks()
})

function take(action: NookIdentityNextStep) {
  const vault = VaultStateTestFixture.create()
  const openSection = vi.fn()
  const panel = vi
    .spyOn(extensionSetupBrowser, 'openExtensionSidePanel')
    .mockResolvedValue(true)
  const installer = vi
    .spyOn(extensionSetupBrowser, 'openExtensionInstaller')
    .mockResolvedValue()
  takeProtectionStep({ action, vault, openSection })
  return { openSection, panel, installer }
}

describe('taking a set-up step', () => {
  test('Connect extension opens the extension side panel from any page', () => {
    const step = take(NookIdentityNextStep.ConnectExtension)

    expect(step.panel).toHaveBeenCalledOnce()
    expect(step.openSection).not.toHaveBeenCalled()
  })

  test('Install extension opens its store page', () => {
    const step = take(NookIdentityNextStep.InstallExtension)

    expect(step.installer).toHaveBeenCalledOnce()
    expect(step.panel).not.toHaveBeenCalled()
  })

  test('the protections open their own pages', () => {
    expect(
      take(NookIdentityNextStep.AddSyncProvider).openSection,
    ).toHaveBeenCalledWith(WorkspaceSection.Sync)
    expect(
      take(NookIdentityNextStep.AddDevice).openSection,
    ).toHaveBeenCalledWith(WorkspaceSection.AddDevice)
  })
})
