import { ok } from 'neverthrow'
import { beforeEach, describe, expect, test, vi } from 'vitest'

/** The explicit-lock mark lives in browser session storage, which the WASM
 * build cannot reach here; the lock policy deciding on the key is real. */
const markVaultSessionLocked = vi.hoisted(() => vi.fn())

vi.mock('$app-wasm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$app-wasm')>()),
  set_vault_session_locked: markVaultSessionLocked,
}))

import { DeviceProtectionStatus, VaultIdentityKeySource } from '$app-wasm'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import { ExtensionSessionLockedNotice } from '$web-shared/extension/runtime-messages'
import { DeviceProtectionLockOutcome } from '$lib/vault/device-protection.svelte'
import { extensionConnectionBrowser } from '$lib/extension/connect'
import {
  PairedExtensionLockActions,
  type PairedExtensionLockRequest,
} from '$lib/vault/paired-extension-lock'
import type { VaultState } from '$lib/vault.svelte'
import { VaultStateTestFixture } from '../vault-state-test-fixture'

type LockScene = {
  readonly vault: VaultState
  readonly extension: { requestPairedExtensionLock: ReturnType<typeof vi.fn> }
  readonly lockVault: ReturnType<typeof vi.fn>
  readonly lockDeviceProtection: ReturnType<typeof vi.fn>
  readonly actions: PairedExtensionLockActions
}

/** A page whose identity key lives where the scene says, with its locks
 * observed and the extension answering as told. */
function lockScene(
  keySource: VaultIdentityKeySource,
  extensionLocks = true,
): LockScene {
  const vault = VaultStateTestFixture.create()
  vault.identityKeySource = keySource
  const lockVault = vi.fn(() => {
    vault.isAuthenticated = false
    vault.deviceProtectionStatus = DeviceProtectionStatus.Passkey
  })
  const lockDeviceProtection = vi.fn(() => {
    vault.deviceProtectionStatus = DeviceProtectionStatus.Passkey
    return Promise.resolve(ok(DeviceProtectionLockOutcome.Locked))
  })
  vault.lockVault = lockVault
  vault.lockDeviceProtection = lockDeviceProtection
  const extension = {
    requestPairedExtensionLock: vi.fn(() => Promise.resolve(extensionLocks)),
    // The page's own connection hears the notices the bridge posts.
    followPairedExtensionLock: (onlocked: () => void) =>
      extensionConnectionBrowser.followPairedExtensionLock(onlocked),
  }
  const request: PairedExtensionLockRequest = { vault, companion: extension }
  const actions = new PairedExtensionLockActions(request)
  return { vault, extension, lockVault, lockDeviceProtection, actions }
}

/** Posts to this page as the vault bridge does, from `origin`. */
function postToPage(data: unknown, origin = window.location.origin): void {
  const init: MessageEventInit = { data, origin, source: window }
  window.dispatchEvent(new MessageEvent('message', init))
}

beforeEach(() => {
  markVaultSessionLocked.mockClear()
})

describe('locking the page with its paired extension', () => {
  test('the person locking a page keyed in the extension locks the extension', async () => {
    const scene = lockScene(VaultIdentityKeySource.PairedCompanion)

    scene.actions.lockPairedExtension()
    await Promise.resolve()

    expect(scene.extension.requestPairedExtensionLock).toHaveBeenCalledTimes(1)
    expect(scene.vault.errorMsg).toBe('')
  })

  test('a page keyed on this browser locks alone', () => {
    const scene = lockScene(VaultIdentityKeySource.ThisBrowser)

    scene.actions.lockPairedExtension()

    expect(scene.extension.requestPairedExtensionLock).not.toHaveBeenCalled()
  })

  test('says so when the extension did not lock', async () => {
    const scene = lockScene(VaultIdentityKeySource.PairedCompanion, false)

    scene.actions.lockPairedExtension()
    await vi.waitFor(() =>
      expect(scene.vault.errorMsg).toBe(
        scene.vault.t(I18N_KEYS.SessionPairedExtensionLockFailed),
      ),
    )
  })

  test('locking the identity key from its card holds the page and locks the extension', () => {
    const scene = lockScene(VaultIdentityKeySource.PairedCompanion)
    scene.vault.deviceProtectionStatus = DeviceProtectionStatus.Unlocked

    scene.actions.lockIdentityKey()

    expect(markVaultSessionLocked).toHaveBeenCalledWith(true)
    expect(scene.lockDeviceProtection).toHaveBeenCalledTimes(1)
    expect(scene.extension.requestPairedExtensionLock).toHaveBeenCalledTimes(1)
  })
})

describe('following the paired extension lock', () => {
  test('an open vault keyed in the extension locks, without asking it back', () => {
    const scene = lockScene(VaultIdentityKeySource.PairedCompanion)
    scene.vault.isAuthenticated = true
    scene.vault.deviceProtectionStatus = DeviceProtectionStatus.Unlocked

    scene.actions.followPairedExtensionLock()

    expect(scene.lockVault).toHaveBeenCalledTimes(1)
    expect(scene.extension.requestPairedExtensionLock).not.toHaveBeenCalled()
  })

  test('an unlocked identity without an open vault locks its key', () => {
    const scene = lockScene(VaultIdentityKeySource.PairedCompanion)
    scene.vault.deviceProtectionStatus = DeviceProtectionStatus.Unlocked

    scene.actions.followPairedExtensionLock()

    expect(markVaultSessionLocked).toHaveBeenCalledWith(true)
    expect(scene.lockDeviceProtection).toHaveBeenCalledTimes(1)
  })

  test('a page already locked, or keyed on this browser, stays as it is', () => {
    const locked = lockScene(VaultIdentityKeySource.PairedCompanion)
    locked.vault.deviceProtectionStatus = DeviceProtectionStatus.Passkey
    locked.actions.followPairedExtensionLock()

    const ownKey = lockScene(VaultIdentityKeySource.ThisBrowser)
    ownKey.vault.isAuthenticated = true
    ownKey.vault.deviceProtectionStatus = DeviceProtectionStatus.Unlocked
    ownKey.actions.followPairedExtensionLock()

    expect(locked.lockDeviceProtection).not.toHaveBeenCalled()
    expect(ownKey.lockVault).not.toHaveBeenCalled()
  })

  test('hears only the lock notice the bridge posts on this origin', () => {
    const scene = lockScene(VaultIdentityKeySource.PairedCompanion)
    scene.vault.isAuthenticated = true
    scene.vault.deviceProtectionStatus = DeviceProtectionStatus.Unlocked
    const stop = scene.actions.listen()

    postToPage(ExtensionSessionLockedNotice.locked, 'https://foreign.example')
    postToPage({ type: 'nook:something-else' })
    expect(scene.lockVault).not.toHaveBeenCalled()

    postToPage(ExtensionSessionLockedNotice.locked)
    expect(scene.lockVault).toHaveBeenCalledTimes(1)

    stop()
    scene.vault.isAuthenticated = true
    postToPage(ExtensionSessionLockedNotice.locked)
    expect(scene.lockVault).toHaveBeenCalledTimes(1)
  })
})
