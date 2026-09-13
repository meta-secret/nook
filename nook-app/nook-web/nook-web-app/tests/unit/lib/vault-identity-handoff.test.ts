import {
  afterEach,
  describe,
  expect,
  test,
  vi,
  type MockInstance,
} from 'vitest'
import { err, ok, type Result } from 'neverthrow'
import {
  DeviceProtectionStatus,
  DeviceProtectionDeviceModeState,
  ExternalDeviceIdentityAuthorizationMode,
  NookClientRunModeUtil,
  NookRuntimeConfig,
  NookVaultManager,
  type NookAdoptedExtensionIdentityHandoff,
  type NookCommittedExtensionIdentityHandoff,
} from '$app-wasm'
import { VaultState } from '$lib/vault.svelte'
import {
  VaultInitializationActions,
  shouldAutoAuthorizeE2e,
  type E2eAutoAuthorizationPolicy,
} from '$lib/vault/lifecycle'
import { BrowserIdentityHandoffKind } from '$lib/vault/identity-handoff'
import {
  NativeVaultStorageFailure,
  VaultStorageFailure,
  VaultStorageFailureKind,
} from '$lib/runtime/storage-failure'
import { TranslationMessage } from '$lib/vault/translation'
import { VaultManagerStartup } from '$lib/runtime/wasm-bootstrap'

/** Only the native boundary is doubled; browser lifecycle and handle ownership are real. */
class IdentityHandoffFixture {
  readonly manager = new NookVaultManager()
  readonly state: VaultState
  readonly lifecycle: VaultInitializationActions
  readonly clearUnlockedSession: MockInstance<
    VaultState['clearUnlockedSession']
  >
  readonly rollback = vi.fn((): void => {})
  readonly confirm = vi.fn((): void => {})
  readonly requiresConnect = vi.fn(() => false)
  readonly committed = {
    confirm: this.confirm,
    rollback: vi.fn((): void => {}),
    free: vi.fn(),
    [Symbol.dispose]: vi.fn(),
  } satisfies NookCommittedExtensionIdentityHandoff
  readonly commit = vi.fn(async () => this.committed)
  readonly adopted = {
    requires_connect: this.requiresConnect,
    mark_existing_vault_import: vi.fn((): void => {}),
    commit: this.commit,
    after_verified_connect: vi.fn(() => this.committed),
    rollback: this.rollback,
    free: vi.fn(),
    [Symbol.dispose]: vi.fn(),
  } satisfies NookAdoptedExtensionIdentityHandoff
  private storageAdmission: Result<void, VaultStorageFailure> = ok()

  constructor() {
    const browserWindow = globalThis.window
    Reflect.deleteProperty(globalThis, 'window')
    try {
      this.state = new VaultState()
    } finally {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        writable: true,
        value: browserWindow,
      })
    }
    this.lifecycle = new VaultInitializationActions(this.state)
    this.clearUnlockedSession = vi
      .spyOn(this.state, 'clearUnlockedSession')
      .mockImplementation(() => {})
    this.state.openManager(this.manager)
    this.state.deviceProtectionStatus = DeviceProtectionStatus.Passkey
    this.state.deviceProtectionLockedStatus = DeviceProtectionStatus.Passkey
    vi.spyOn(this.manager, 'device_id', 'get').mockReturnValue('adopted-device')
    vi.spyOn(this.manager, 'device_public_key', 'get').mockReturnValue(
      'adopted-public-key',
    )
    vi.spyOn(this.state, 't').mockImplementation((request) =>
      new TranslationMessage(request).translationKey(),
    )
    vi.spyOn(this.state, 'enqueueStorage').mockImplementation((operation) =>
      this.enqueueStorage(operation),
    )
  }

  private async enqueueStorage<T, E>(
    operation: () => Result<T, E> | Promise<Result<T, E>>,
  ): Promise<Result<T, E | VaultStorageFailure>> {
    if (this.storageAdmission.isErr()) return err(this.storageAdmission.error)
    return operation()
  }

  denyCommitAdmission(kind: VaultStorageFailureKind): void {
    this.requiresConnect.mockImplementationOnce(() => {
      // Simulate deletion/generation invalidation immediately before commit admission.
      this.storageAdmission = err(new VaultStorageFailure(kind))
      return false
    })
  }

  authorize(): Promise<boolean> {
    return this.lifecycle.authorizeWithExternalDeviceIdentity({
      adopt: async () => ok(this.adopted),
      mode: ExternalDeviceIdentityAuthorizationMode.DeferInitialization,
    })
  }

  expectRelocked(): void {
    expect(this.clearUnlockedSession).toHaveBeenCalledExactlyOnceWith(false)
    expect(this.state.externalIdentityHandoff).toEqual({
      kind: BrowserIdentityHandoffKind.Inactive,
    })
    expect(this.state.deviceProtectionStatus).toBe(
      DeviceProtectionStatus.Passkey,
    )
    expect(this.state.isAuthenticated).toBe(false)
    expect(this.state.deviceId).toBe('')
    expect(this.state.devicePublicKey).toBe('')
    expect(this.state.deviceAuthorizationInProgress).toBe(false)
    expect(this.state.isVerifying).toBe(false)
  }

  dispose(): void {
    this.state.clearManager()
    this.manager.free()
  }
}

afterEach(() => {
  sessionStorage.removeItem('nook_vault_session_locked')
  vi.restoreAllMocks()
})

describe('external browser identity handoff commit ownership', () => {
  test('defers device synchronization until pending enrollment is admitted', async () => {
    const fixture = new IdentityHandoffFixture()
    try {
      const synchronizationFailure = new VaultStorageFailure(
        VaultStorageFailureKind.OperationFailed,
      )
      fixture.state.deviceAuthorizationInProgress = true
      fixture.state.pendingEnrollmentFromUrl = 'pending-enrollment'
      vi.spyOn(
        fixture.manager,
        'has_pending_sentinel_genesis_finalization',
      ).mockResolvedValue(false)
      vi.spyOn(fixture.state, 'loadProviders').mockResolvedValue(ok())
      vi.spyOn(fixture.state, 'refreshLocalVaultCatalog').mockResolvedValue(
        ok(),
      )
      const refreshDeviceState = vi
        .spyOn(fixture.state, 'refreshDeviceState')
        .mockResolvedValue(err(synchronizationFailure))

      const continued =
        await fixture.lifecycle.continueInitializationAfterDeviceUnlock()

      expect(continued.isOk()).toBe(true)
      expect(refreshDeviceState).not.toHaveBeenCalled()
      expect(fixture.state.enrollmentFromUrlPending).toBe(true)
      expect(fixture.state.prefillEnrollmentCode).toBe('pending-enrollment')
    } finally {
      fixture.dispose()
    }
  })

  test('exposes recovery when persisted protection status cannot be read', async () => {
    const fixture = new IdentityHandoffFixture()
    try {
      fixture.state.clearManager()
      vi.spyOn(VaultManagerStartup.prototype, 'open').mockResolvedValue(
        ok(fixture.manager),
      )
      vi.spyOn(fixture.state, 'updateLocale').mockResolvedValue(ok())
      vi.spyOn(fixture.state, 'refreshLocalVaultCatalog').mockResolvedValue(
        ok(),
      )
      vi.spyOn(fixture.manager, 'device_protection_status').mockRejectedValue(
        new Error('identity directory cannot be read'),
      )

      await fixture.lifecycle.initOnce()

      expect(fixture.state.deviceProtectionStatus).toBe(
        DeviceProtectionStatus.Error,
      )
      expect(fixture.state.errorMsg).toBe(
        new NativeVaultStorageFailure(
          new Error('identity directory cannot be read'),
        ).translationKey,
      )
    } finally {
      fixture.dispose()
    }
  })

  test('relocks automatic authorization when typed initialization continuation fails', async () => {
    const fixture = new IdentityHandoffFixture()
    try {
      const continuationFailure = new VaultStorageFailure(
        VaultStorageFailureKind.OperationFailed,
      )
      fixture.state.clearManager()
      fixture.state.runtimeConfig = new NookRuntimeConfig(
        NookClientRunModeUtil.parse('production'),
        true,
      )
      localStorage.removeItem('nook_e2e_manual_passkey')
      sessionStorage.removeItem('nook_vault_session_locked')
      vi.spyOn(VaultManagerStartup.prototype, 'open').mockResolvedValue(
        ok(fixture.manager),
      )
      vi.spyOn(fixture.state, 'updateLocale').mockResolvedValue(ok())
      vi.spyOn(fixture.state, 'refreshLocalVaultCatalog').mockResolvedValue(
        ok(),
      )
      vi.spyOn(fixture.manager, 'device_protection_status').mockResolvedValue(
        DeviceProtectionStatus.Passkey,
      )
      vi.spyOn(
        fixture.manager,
        'device_protection_device_mode',
      ).mockResolvedValue(DeviceProtectionDeviceModeState.Standard)
      vi.spyOn(
        fixture.manager,
        'unlock_device_protection_with_passkey',
      ).mockImplementation(async () => {})
      vi.spyOn(
        fixture.lifecycle,
        'continueInitializationAfterDeviceUnlock',
      ).mockResolvedValue(err(continuationFailure))
      const lockDeviceProtection = vi
        .spyOn(fixture.state, 'lockDeviceProtection')
        .mockResolvedValue(ok())

      await fixture.lifecycle.initOnce()

      expect(lockDeviceProtection).toHaveBeenCalledOnce()
      expect(fixture.state.deviceProtectionStatus).not.toBe(
        DeviceProtectionStatus.Unlocked,
      )
      expect(fixture.state.errorMsg).toBe(continuationFailure.translationKey)
      expect(fixture.state.deviceAuthorizationInProgress).toBe(false)
    } finally {
      fixture.dispose()
    }
  })

  test('does not auto-authorize after an idle session lock', () => {
    const lockedPolicy: E2eAutoAuthorizationPolicy = {
      e2eExposeVault: true,
      manualPasskey: false,
      sessionLocked: true,
    }
    expect(shouldAutoAuthorizeE2e(lockedPolicy)).toBe(false)

    const unlockedPolicy: E2eAutoAuthorizationPolicy = {
      ...lockedPolicy,
      sessionLocked: false,
    }
    expect(shouldAutoAuthorizeE2e(unlockedPolicy)).toBe(true)
  })

  test.each([
    VaultStorageFailureKind.DeletionActive,
    VaultStorageFailureKind.GenerationChanged,
  ])(
    'rolls back when commit admission fails with %s before invoking its callback',
    async (kind) => {
      const fixture = new IdentityHandoffFixture()
      try {
        fixture.denyCommitAdmission(kind)
        expect(await fixture.authorize()).toBe(false)
        expect(fixture.adopted.mark_existing_vault_import).toHaveBeenCalledWith(
          fixture.manager,
        )
        expect(fixture.commit).not.toHaveBeenCalled()
        expect(fixture.confirm).not.toHaveBeenCalled()
        expect(fixture.rollback).toHaveBeenCalledExactlyOnceWith(
          fixture.manager,
        )
        fixture.expectRelocked()
        expect(fixture.state.errorMsg).toBe(
          new VaultStorageFailure(kind).translationKey,
        )
      } finally {
        fixture.dispose()
      }
    },
  )

  test('confirms a successful commit without rolling back the consumed handle', async () => {
    const fixture = new IdentityHandoffFixture()
    try {
      expect(await fixture.authorize()).toBe(true)
      expect(fixture.commit).toHaveBeenCalledExactlyOnceWith(fixture.manager)
      expect(fixture.confirm).toHaveBeenCalledExactlyOnceWith(fixture.manager)
      expect(fixture.rollback).not.toHaveBeenCalled()
      expect(fixture.clearUnlockedSession).not.toHaveBeenCalled()
      expect(fixture.state.externalIdentityHandoff).toEqual({
        kind: BrowserIdentityHandoffKind.Inactive,
      })
      expect(fixture.state.deviceProtectionStatus).toBe(
        DeviceProtectionStatus.Unlocked,
      )
      expect(fixture.state.deviceId).toBe('adopted-device')
      expect(fixture.state.deviceAuthorizationInProgress).toBe(false)
      expect(fixture.state.isVerifying).toBe(false)
    } finally {
      fixture.dispose()
    }
  })

  test('relocks after a consuming commit fails without invoking native rollback twice', async () => {
    const fixture = new IdentityHandoffFixture()
    try {
      // Rust owns cleanup after its consuming commit rejects. The browser must not reuse it.
      fixture.commit.mockRejectedValueOnce(
        new Error('native consuming commit failed'),
      )
      expect(await fixture.authorize()).toBe(false)
      expect(fixture.commit).toHaveBeenCalledExactlyOnceWith(fixture.manager)
      expect(fixture.confirm).not.toHaveBeenCalled()
      expect(fixture.rollback).not.toHaveBeenCalled()
      fixture.expectRelocked()
    } finally {
      fixture.dispose()
    }
  })
})
