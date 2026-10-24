import { afterEach, describe, expect, test, vi } from 'vitest'
import { DeviceProtectionStatus, VaultIdentityKeySource } from '$app-wasm'
import {
  BrowserKeySwitch,
  BrowserKeySwitchOutcome,
} from '$lib/vault/browser-key-switch'
import {
  DeviceProtectionActionOutcome,
  DeviceProtectionActions,
} from '$lib/vault/device-protection.svelte'
import { WorkspaceSection } from '$lib/vault/state/ui.svelte'
import type { VaultState } from '$lib/vault.svelte'
import { VaultStateTestFixture } from '../vault-state-test-fixture'

afterEach(() => {
  vi.restoreAllMocks()
})

const STORE_ID = 'store_vault'

type Session = {
  readonly keySource?: VaultIdentityKeySource
  readonly protection?: DeviceProtectionStatus
}

function extensionSession(session: Session): VaultState {
  const vault = VaultStateTestFixture.create()
  vault.identityKeySource =
    session.keySource ?? VaultIdentityKeySource.PairedCompanion
  vault.deviceProtectionLockedStatus =
    session.protection ?? DeviceProtectionStatus.Passkey
  vault.openActiveVault(STORE_ID)
  vault.isAuthenticated = true
  vault.workspaceSection = WorkspaceSection.AddDevice
  return vault
}

function switchSpies(vault: VaultState) {
  const lockVault = vi.spyOn(vault, 'lockVault').mockImplementation(() => {
    vault.isAuthenticated = false
  })
  vi.spyOn(vault, 'waitForStorageChain').mockResolvedValue()
  const chooseLoginVault = vi
    .spyOn(vault, 'chooseLoginVault')
    .mockResolvedValue(true)
  const unlock = vi
    .spyOn(DeviceProtectionActions.prototype, 'unlockDeviceProtection')
    .mockResolvedValue(DeviceProtectionActionOutcome.Ready)
  const loadDb = vi.spyOn(vault, 'loadDb').mockImplementation(async () => {
    vault.isAuthenticated = true
  })
  const openSection = vi.spyOn(vault, 'openSection')
  return { lockVault, chooseLoginVault, unlock, loadDb, openSection }
}

describe("switching from the extension's key to this browser's passkey", () => {
  test("is offered while the extension's key is in use and this browser has a passkey", () => {
    expect(new BrowserKeySwitch(extensionSession({})).available).toBe(true)
    expect(
      new BrowserKeySwitch(
        extensionSession({ keySource: VaultIdentityKeySource.ThisBrowser }),
      ).available,
    ).toBe(false)
    expect(
      new BrowserKeySwitch(
        extensionSession({ protection: DeviceProtectionStatus.Pin }),
      ).available,
    ).toBe(false)
  })

  test('locks only this page, unlocks with the passkey, and returns to the same vault and page', async () => {
    const vault = extensionSession({})
    const spies = switchSpies(vault)

    const outcome = await new BrowserKeySwitch(vault).run()

    expect(outcome).toBe(BrowserKeySwitchOutcome.Switched)
    expect(spies.lockVault).toHaveBeenCalledOnce()
    expect(spies.chooseLoginVault).toHaveBeenCalledWith(STORE_ID)
    expect(spies.unlock).toHaveBeenCalledWith({ initializeSession: true })
    expect(spies.loadDb).toHaveBeenCalledOnce()
    expect(spies.openSection).toHaveBeenCalledWith(WorkspaceSection.AddDevice)
  })

  test('a passkey that does not unlock leaves the page locked', async () => {
    const vault = extensionSession({})
    const spies = switchSpies(vault)
    spies.unlock.mockResolvedValue(DeviceProtectionActionOutcome.Incomplete)

    const outcome = await new BrowserKeySwitch(vault).run()

    expect(outcome).toBe(BrowserKeySwitchOutcome.Incomplete)
    expect(spies.loadDb).not.toHaveBeenCalled()
    expect(spies.openSection).not.toHaveBeenCalled()
  })
})
