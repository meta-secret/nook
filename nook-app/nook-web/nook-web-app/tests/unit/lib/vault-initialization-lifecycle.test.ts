import { ProviderSyncOutcome } from '$lib/vault/provider-sync.svelte'
import {
  afterEach,
  describe,
  expect,
  test,
  vi,
  type MockInstance,
} from 'vitest'
import { err, ok, type Result } from 'neverthrow'

vi.mock('$app-wasm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$app-wasm')>()),
  // Node's global is not a web_sys Window; retain the fixture's storage state.
  is_vault_session_locked: () => {
    const stored = sessionStorage.getItem('nook_vault_session_locked')
    return stored === '1' || stored === 'true'
  },
}))
import {
  DeviceProtectionStatus,
  DeviceProtectionDeviceModeState,
  NookClientRunModeUtil,
  NookRuntimeConfig,
  NookVaultManager,
} from '$app-wasm'
import { VaultState } from '$lib/vault.svelte'
import { DeviceProtectionLockOutcome } from '$lib/vault/device-protection.svelte'
import {
  VaultInitializationActions,
  shouldAutoAuthorizeE2e,
  type E2eAutoAuthorizationPolicy,
} from '$lib/vault/lifecycle'
import {
  NativeVaultStorageFailure,
  VaultStorageFailure,
  VaultStorageFailureKind,
} from '$lib/runtime/storage-failure'
import { TranslationMessage } from '$lib/vault/translation'
import { VaultManagerStartup } from '$lib/runtime/wasm-bootstrap'
import { unselectedVaultScope } from '$lib/auth/providers'
import { LocaleUpdateOutcome } from '$lib/vault/locale'

/** Only the native boundary is doubled; browser lifecycle is real. */
class VaultLifecycleFixture {
  readonly manager = new NookVaultManager()
  readonly state: VaultState
  readonly lifecycle: VaultInitializationActions
  readonly clearUnlockedSession: MockInstance<
    VaultState['clearUnlockedSession']
  >

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
    this.state.isInitializing = false
    this.state.deviceProtectionStatus = DeviceProtectionStatus.Passkey
    this.state.deviceProtectionLockedStatus = DeviceProtectionStatus.Passkey
    vi.spyOn(this.manager, 'device_id', 'get').mockReturnValue('browser-device')
    vi.spyOn(this.manager, 'device_public_key', 'get').mockReturnValue(
      'browser-public-key',
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
    return operation()
  }

  dispose(): void {
    this.state.clearManager()
    this.manager.free()
  }
}

afterEach(() => {
  document.documentElement.removeAttribute('data-nook-extension-runtime-id')
  sessionStorage.removeItem('nook_vault_session_locked')
  vi.restoreAllMocks()
})

describe('vault initialization lifecycle', () => {
  test('keeps an explicitly locked website vault locked', () => {
    const fixture = new VaultLifecycleFixture()
    try {
      fixture.state.localVaultPresent = true
      sessionStorage.setItem('nook_vault_session_locked', 'true')
      expect(fixture.state.shouldAutoUnlock()).toBe(false)
      expect(fixture.state.errorMsg).toBe('')
    } finally {
      fixture.dispose()
    }
  })

  test('defers device synchronization until pending enrollment is admitted', async () => {
    const fixture = new VaultLifecycleFixture()
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
      vi.spyOn(fixture.state, 'loadProviders').mockResolvedValue(
        ok({ providers: [], activeVaultStoreId: unselectedVaultScope() }),
      )
      vi.spyOn(fixture.state, 'refreshLocalVaultCatalog').mockResolvedValue(
        ok(fixture.state.localVaultCatalog),
      )
      const refreshDeviceState = vi
        .spyOn(fixture.state, 'refreshDeviceState')
        .mockResolvedValue(err(synchronizationFailure))

      const continued =
        await fixture.lifecycle.continueInitializationAfterDeviceUnlock()

      expect(continued.isOk()).toBe(true)
      expect(
        continued.match(
          (snapshot) => snapshot,
          (failure) => failure,
        ),
      ).toEqual({
        deviceId: fixture.state.deviceId,
        devicePublicKey: fixture.state.devicePublicKey,
      })
      expect(refreshDeviceState).not.toHaveBeenCalled()
      expect(fixture.state.enrollmentFromUrlPending).toBe(true)
      expect(fixture.state.prefillEnrollmentCode).toBe('pending-enrollment')
    } finally {
      fixture.dispose()
    }
  })

  test('exposes recovery when persisted protection status cannot be read', async () => {
    const fixture = new VaultLifecycleFixture()
    try {
      fixture.state.clearManager()
      vi.spyOn(VaultManagerStartup.prototype, 'open').mockResolvedValue(
        ok(fixture.manager),
      )
      vi.spyOn(fixture.state, 'updateLocale').mockResolvedValue(
        ok(LocaleUpdateOutcome.Updated),
      )
      vi.spyOn(fixture.state, 'refreshLocalVaultCatalog').mockResolvedValue(
        ok(fixture.state.localVaultCatalog),
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

  test('auto-unlocks a persisted local vault only after initialization is ready', async () => {
    const fixture = new VaultLifecycleFixture()
    try {
      fixture.state.clearManager()
      fixture.state.localVaultPresent = true
      fixture.state.runtimeConfig = new NookRuntimeConfig(
        NookClientRunModeUtil.parse('production'),
        true,
      )
      sessionStorage.removeItem('nook_vault_session_locked')
      vi.spyOn(VaultManagerStartup.prototype, 'open').mockResolvedValue(
        ok(fixture.manager),
      )
      vi.spyOn(fixture.state, 'updateLocale').mockResolvedValue(
        ok(LocaleUpdateOutcome.Updated),
      )
      vi.spyOn(fixture.state, 'refreshLocalVaultCatalog').mockResolvedValue(
        ok(fixture.state.localVaultCatalog),
      )
      vi.spyOn(fixture.manager, 'device_protection_status').mockResolvedValue(
        DeviceProtectionStatus.Unlocked,
      )
      vi.spyOn(
        fixture.manager,
        'device_protection_device_mode',
      ).mockResolvedValue(DeviceProtectionDeviceModeState.Standard)
      vi.spyOn(
        fixture.lifecycle,
        'continueInitializationAfterDeviceUnlock',
      ).mockImplementation(async () => {
        expect(fixture.state.isInitializing).toBe(true)
        return ok({
          deviceId: 'persisted-device',
          devicePublicKey: 'persisted-public-key',
        })
      })
      const loadDb = vi
        .spyOn(fixture.state, 'loadDb')
        .mockImplementation(async () => {
          expect(fixture.state.isInitializing).toBe(false)
          expect(fixture.state.deviceAuthorizationInProgress).toBe(false)
          fixture.state.isAuthenticated = true
        })
      vi.spyOn(fixture.state, 'runFanOutSyncAfterLocalSave').mockResolvedValue(
        ok({ publishedEventRecordCount: 0, outboxFlushes: [] }),
      )
      vi.spyOn(fixture.state, 'startVaultSync').mockImplementation(() => {})

      await fixture.lifecycle.initOnce()

      expect(fixture.state.errorMsg).toBe('')
      expect(fixture.state.isInitializing).toBe(false)
      expect(loadDb).toHaveBeenCalledOnce()
      expect(fixture.state.isAuthenticated).toBe(true)
    } finally {
      fixture.dispose()
    }
  })

  test.each([false, true])(
    'defers website unlock until companion discovery (pending enrollment=%s)',
    async (pendingEnrollment) => {
      document.documentElement.setAttribute(
        'data-nook-extension-runtime-id',
        'extension-123',
      )
      const fixture = new VaultLifecycleFixture()
      try {
        fixture.state.clearManager()
        fixture.state.localVaultPresent = true
        if (pendingEnrollment)
          fixture.state.pendingEnrollmentFromUrl = 'pending-enrollment'
        const clearEnrollmentUrl = vi.spyOn(
          fixture.state,
          'clearPendingEnrollmentFromUrl',
        )
        vi.spyOn(fixture.state, 'refreshDeviceState').mockResolvedValue(
          ok(ProviderSyncOutcome.Synced),
        )
        fixture.state.runtimeConfig = new NookRuntimeConfig(
          NookClientRunModeUtil.parse('production'),
          true,
        )
        sessionStorage.removeItem('nook_vault_session_locked')
        vi.spyOn(VaultManagerStartup.prototype, 'open').mockResolvedValue(
          ok(fixture.manager),
        )
        vi.spyOn(fixture.state, 'updateLocale').mockResolvedValue(
          ok(LocaleUpdateOutcome.Updated),
        )
        vi.spyOn(fixture.state, 'refreshLocalVaultCatalog').mockResolvedValue(
          ok(fixture.state.localVaultCatalog),
        )
        vi.spyOn(fixture.manager, 'device_protection_status').mockResolvedValue(
          DeviceProtectionStatus.Unlocked,
        )
        vi.spyOn(
          fixture.manager,
          'device_protection_device_mode',
        ).mockResolvedValue(DeviceProtectionDeviceModeState.Standard)
        vi.spyOn(
          fixture.lifecycle,
          'continueInitializationAfterDeviceUnlock',
        ).mockImplementation(async () => {
          expect(fixture.state.isInitializing).toBe(true)
          return ok({
            deviceId: 'persisted-device',
            devicePublicKey: 'persisted-public-key',
          })
        })
        const loadDb = vi
          .spyOn(fixture.state, 'loadDb')
          .mockImplementation(async () => {
            expect(fixture.state.isInitializing).toBe(false)
            expect(fixture.state.deviceAuthorizationInProgress).toBe(false)
            fixture.state.isAuthenticated = true
          })
        vi.spyOn(
          fixture.state,
          'runFanOutSyncAfterLocalSave',
        ).mockResolvedValue(
          ok({ publishedEventRecordCount: 0, outboxFlushes: [] }),
        )
        vi.spyOn(fixture.state, 'startVaultSync').mockImplementation(() => {})

        await fixture.lifecycle.initOnce()

        expect(fixture.state.errorMsg).toBe('')
        expect(fixture.state.isInitializing).toBe(false)
        expect(loadDb).not.toHaveBeenCalled()
        expect(fixture.state.isAuthenticated).toBe(false)
        expect(fixture.state.enrollmentFromUrlPending).toBe(pendingEnrollment)
        expect(fixture.state.prefillEnrollmentCode).toBe(
          pendingEnrollment ? 'pending-enrollment' : '',
        )
        expect(clearEnrollmentUrl).toHaveBeenCalledTimes(
          Number(pendingEnrollment),
        )
      } finally {
        fixture.dispose()
      }
    },
  )

  test('relocks automatic authorization when typed initialization continuation fails', async () => {
    const fixture = new VaultLifecycleFixture()
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
      vi.spyOn(fixture.state, 'updateLocale').mockResolvedValue(
        ok(LocaleUpdateOutcome.Updated),
      )
      vi.spyOn(fixture.state, 'refreshLocalVaultCatalog').mockResolvedValue(
        ok(fixture.state.localVaultCatalog),
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
        .mockResolvedValue(ok(DeviceProtectionLockOutcome.Locked))

      const loadDb = vi.spyOn(fixture.state, 'loadDb')
      await fixture.lifecycle.initOnce()
      expect(loadDb).not.toHaveBeenCalled()
      expect(fixture.state.isInitializing).toBe(false)

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

  test('preserves the original relock and error surface when completion throws', async () => {
    const fixture = new VaultLifecycleFixture()
    try {
      const completionFailure = new Error('completion policy failed')
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
      vi.spyOn(fixture.state, 'updateLocale').mockResolvedValue(
        ok(LocaleUpdateOutcome.Updated),
      )
      vi.spyOn(fixture.state, 'refreshLocalVaultCatalog').mockResolvedValue(
        ok(fixture.state.localVaultCatalog),
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
      ).mockResolvedValue(
        ok({ deviceId: 'ready-device', devicePublicKey: 'ready-public-key' }),
      )
      vi.spyOn(fixture.state, 'shouldAutoUnlock').mockImplementation(() => {
        expect(fixture.state.isInitializing).toBe(false)
        throw completionFailure
      })
      const lockDeviceProtection = vi
        .spyOn(fixture.state, 'lockDeviceProtection')
        .mockImplementation(async () => {
          fixture.state.deviceProtectionStatus = DeviceProtectionStatus.Passkey
          return ok(DeviceProtectionLockOutcome.Locked)
        })

      const loadDb = vi.spyOn(fixture.state, 'loadDb')
      await fixture.lifecycle.initOnce()
      expect(loadDb).not.toHaveBeenCalled()
      expect(fixture.state.isInitializing).toBe(false)

      await vi.waitFor(() =>
        expect(lockDeviceProtection).toHaveBeenCalledOnce(),
      )
      expect(fixture.state.deviceProtectionStatus).not.toBe(
        DeviceProtectionStatus.Unlocked,
      )
      expect(fixture.state.errorMsg).toBe(completionFailure.message)
      expect(fixture.state.isAuthenticated).toBe(false)
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
})
