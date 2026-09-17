import { err, ok, type Result } from 'neverthrow'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { admit_extension_pairing_vault_type } from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { companionWasmReady } from '../../../../nook-web-shared/src/extension/companion-ready'

await companionWasmReady

const simplePairingVaultType = admit_extension_pairing_vault_type('simple')

const wasm = vi.hoisted(() => ({
  approveExtensionDevice: vi.fn(),
}))
const defaultStoreIdFree = vi.fn()

vi.mock('$app-wasm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$app-wasm')>()),
  approve_extension_device: wasm.approveExtensionDevice,
  classify_vault_recovery_error: () => 'other',
  VaultRecoveryErrorKind: { Other: 'other' },
}))

vi.mock('$lib/auth/providers', async (importOriginal) => {
  const original = await importOriginal<typeof import('$lib/auth/providers')>()
  return {
    ...original,
    activeVaultScope: vi.fn(original.activeVaultScope),
    providerBelongsToVault: vi.fn(),
    seal_auth_providers_for_device_public_key: vi.fn(),
  }
})

import {
  NookVaultManager,
  type NookEventLogRecords,
} from '../../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import {
  activeVaultScope,
  seal_auth_providers_for_device_public_key,
  type AuthProvidersSnapshot,
} from '$lib/auth/providers'
import {
  ExtensionConnectScope,
  ExtensionIdentityRequestSource,
  ExtensionPairingDeliveryKind,
  ExtensionPairingRejectionReason,
  extensionConnectionBrowser,
  type ExtensionConnectRequest,
} from '$lib/extension/connect'
import { ExtensionVaultApproval } from '$lib/extension/vault-approval'
import {
  VaultStorageFailure,
  VaultStorageFailureKind,
} from '$lib/runtime/storage-failure'
import type { VaultState } from '$lib/vault.svelte'
import { VaultStateTestFixture } from '../vault-state-test-fixture'

const request: ExtensionConnectRequest = {
  source: ExtensionIdentityRequestSource.ExtensionConnect,
  deviceId: 'device-1',
  devicePublicKey: 'age1device',
  deviceSigningPublicKey: 'signing-key',
  extensionRuntimeId: 'extension-123',
  deviceLabel: 'Nook Extension',
  nonce: 'nonce-1',
  scopes: [ExtensionConnectScope.VaultAccess],
}

class ExtensionApprovalTestFixture {
  static create() {
    const records = {
      to_array: vi.fn(() => []),
      free: vi.fn(),
      [Symbol.dispose]: vi.fn(),
    } satisfies NookEventLogRecords
    const manager = new NookVaultManager()
    Object.defineProperty(manager, 'vaultStoreId', {
      configurable: true,
      value: 'store-1',
    })
    manager.export_event_log_records_js = vi.fn(async () => records)
    const admitManager = vi.fn<
      () => Result<NookVaultManager, VaultStorageFailure>
    >(() => ok(manager))
    const vault = VaultStateTestFixture.create()
    vault.openActiveVault('store-1')
    vault.openManager(manager)
    const immediateStorage: VaultState['enqueueStorage'] = async (operation) =>
      operation()
    vault.enqueueStorage = immediateStorage
    vault.localVaults = []
    vault.admitManager = admitManager
    vault.t = (key: Parameters<VaultState['t']>[0]) =>
      typeof key === 'string' ? key : 'Unnamed vault'
    return { admitManager, manager, records, vault }
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
  defaultStoreIdFree.mockReset()
  wasm.approveExtensionDevice.mockImplementation(async () => ({
    get storeId() {
      return { value: 'store-1', free: defaultStoreIdFree }
    },
    approvedAt: 1_783_373_640_000,
    vaultType: simplePairingVaultType,
    free: vi.fn(),
  }))
})

describe('extension vault approval', () => {
  test('authorizes, exports, and delivers one generation-consistent grant', async () => {
    const fixture = ExtensionApprovalTestFixture.create()
    const deliver = vi
      .spyOn(extensionConnectionBrowser, 'deliverExtensionPairingApproval')
      .mockResolvedValue({ kind: ExtensionPairingDeliveryKind.Delivered })
    const approval = new ExtensionVaultApproval(fixture.vault, request)

    const authorized = await approval.authorize()
    expect(authorized.isOk()).toBe(true)
    if (authorized.isErr()) return
    expect(authorized.value.approvedAt).toBe(1_783_373_640_000)
    expect(authorized.value.vaultType).toBe(simplePairingVaultType)
    expect(fixture.manager.export_event_log_records_js).not.toHaveBeenCalled()
    const prepared = await approval.prepareAuthorizedGrant()
    expect(prepared.isOk()).toBe(true)
    if (prepared.isErr()) return
    expect(prepared.value.payload).toMatchObject({
      vaultType: simplePairingVaultType,
      vaultStoreId: 'store-1',
      approvedAt: 1_783_373_640_000,
    })
    expect(typeof prepared.value.payload.approvedAt).toBe('number')
    const completion = approval.admitCompletion()
    expect(completion.isOk()).toBe(true)
    if (completion.isErr()) return
    expect(completion.value.manager).toBe(fixture.manager)
    const delivered = await approval.deliver(prepared.value)

    expect(wasm.approveExtensionDevice).toHaveBeenCalledWith(
      fixture.manager,
      request.deviceId,
      request.devicePublicKey,
      request.deviceSigningPublicKey,
      request.deviceLabel,
    )
    expect(fixture.records.to_array).toHaveBeenCalledOnce()
    expect(fixture.records.free).toHaveBeenCalledOnce()
    expect(deliver).toHaveBeenCalledWith({
      request,
      message: prepared.value,
    })
    expect(delivered.isOk()).toBe(true)
    expect(defaultStoreIdFree).toHaveBeenCalledTimes(2)
    approval.releaseAuthorization()
    expect(authorized.value.free).toHaveBeenCalledOnce()
  })

  test('projects the generated approval store ID at provider and browser boundaries', async () => {
    const fixture = ExtensionApprovalTestFixture.create()
    const authorizationStoreId = 'approval-store-1'
    const storeIdFree = vi.fn()
    const authorizationFree = vi.fn()
    const providerSnapshot: AuthProvidersSnapshot = {
      providers: [],
      activeVaultStoreId: activeVaultScope('store-1'),
    }
    fixture.manager.load_auth_providers_snapshot = vi.fn(
      async () => providerSnapshot,
    )
    vi.mocked(activeVaultScope).mockClear()
    vi.mocked(seal_auth_providers_for_device_public_key).mockImplementation(
      (_devicePublicKey, snapshot) => snapshot,
    )
    wasm.approveExtensionDevice.mockImplementationOnce(async () => ({
      get storeId() {
        return { value: authorizationStoreId, free: storeIdFree }
      },
      approvedAt: 1_783_373_640_000,
      vaultType: simplePairingVaultType,
      free: authorizationFree,
    }))
    const syncRequest: ExtensionConnectRequest = {
      ...request,
      scopes: [
        ...request.scopes,
        ExtensionConnectScope.SyncProviderCredentials,
      ],
    }
    const approval = new ExtensionVaultApproval(fixture.vault, syncRequest)

    const authorized = await approval.authorize()
    expect(authorized.isOk()).toBe(true)
    const prepared = await approval.prepareAuthorizedGrant()

    expect(prepared.isOk()).toBe(true)
    if (prepared.isErr()) return
    expect(fixture.vault.activeVault).toMatchObject({ storeId: 'store-1' })
    expect(fixture.manager.vaultStoreId).toBe('store-1')
    expect(prepared.value.payload.vaultStoreId).toBe(authorizationStoreId)
    expect(activeVaultScope).toHaveBeenCalledWith(authorizationStoreId)
    expect(seal_auth_providers_for_device_public_key).toHaveBeenCalledWith(
      syncRequest.devicePublicKey,
      expect.objectContaining({ providers: [] }),
    )
    expect(wasm.approveExtensionDevice).toHaveBeenCalledOnce()
    expect(storeIdFree).toHaveBeenCalledTimes(2)
    approval.releaseAuthorization()
    expect(authorizationFree).toHaveBeenCalledOnce()
  })

  test('keeps approval valid when the same vault gets a new active-vault record', async () => {
    const fixture = ExtensionApprovalTestFixture.create()
    const deliver = vi
      .spyOn(extensionConnectionBrowser, 'deliverExtensionPairingApproval')
      .mockResolvedValue({ kind: ExtensionPairingDeliveryKind.Delivered })
    const approval = new ExtensionVaultApproval(fixture.vault, request)
    const authorized = await approval.authorize()
    expect(authorized.isOk()).toBe(true)
    const prepared = await approval.prepareAuthorizedGrant()
    expect(prepared.isOk()).toBe(true)
    if (prepared.isErr()) return

    fixture.vault.openActiveVault('store-1')

    const delivered = await approval.deliver(prepared.value)

    expect(delivered.isOk()).toBe(true)
    expect(deliver).toHaveBeenCalledOnce()
  })

  test('preserves a concrete extension rejection across same-vault state replacement', async () => {
    const fixture = ExtensionApprovalTestFixture.create()
    const deliver = vi
      .spyOn(extensionConnectionBrowser, 'deliverExtensionPairingApproval')
      .mockImplementation(async () => {
        fixture.vault.openActiveVault('store-1')
        return {
          kind: ExtensionPairingDeliveryKind.Rejected,
          reason: ExtensionPairingRejectionReason.EventLogAccessNotGranted,
        }
      })
    const approval = new ExtensionVaultApproval(fixture.vault, request)
    const authorized = await approval.authorize()
    expect(authorized.isOk()).toBe(true)
    const prepared = await approval.prepareAuthorizedGrant()
    expect(prepared.isOk()).toBe(true)
    if (prepared.isErr()) return

    const delivered = await approval.deliver(prepared.value)

    expect(delivered.isOk()).toBe(true)
    if (delivered.isErr()) return
    expect(delivered.value).toEqual({
      kind: ExtensionPairingDeliveryKind.Rejected,
      reason: ExtensionPairingRejectionReason.EventLogAccessNotGranted,
    })
    expect(deliver).toHaveBeenCalledOnce()
  })

  test('returns native authorization failures before exporting records', async () => {
    const fixture = ExtensionApprovalTestFixture.create()
    wasm.approveExtensionDevice.mockRejectedValueOnce(
      new Error('authorization rejected'),
    )

    const authorized = await new ExtensionVaultApproval(
      fixture.vault,
      request,
    ).authorize()

    expect(authorized.isErr()).toBe(true)
    expect(fixture.manager.export_event_log_records_js).not.toHaveBeenCalled()
  })

  test('keeps authorization success separate from a later event-log export failure', async () => {
    const fixture = ExtensionApprovalTestFixture.create()
    fixture.records.to_array.mockImplementation(() => {
      throw new Error('event-log export failed')
    })
    const approval = new ExtensionVaultApproval(fixture.vault, request)

    const authorized = await approval.authorize()
    expect(authorized.isOk()).toBe(true)

    const prepared = await approval.prepareAuthorizedGrant()

    expect(prepared.isErr()).toBe(true)
    expect(wasm.approveExtensionDevice).toHaveBeenCalledOnce()
  })

  test('rejects a manager generation change between authorization and export', async () => {
    const fixture = ExtensionApprovalTestFixture.create()
    const replacement = new NookVaultManager()
    fixture.admitManager
      .mockReturnValueOnce(ok(fixture.manager))
      .mockReturnValueOnce(ok(fixture.manager))
      .mockReturnValueOnce(ok(replacement))
    const approval = new ExtensionVaultApproval(fixture.vault, request)
    const authorized = await approval.authorize()
    expect(authorized.isOk()).toBe(true)

    const prepared = await approval.prepareAuthorizedGrant()

    expect(prepared.isErr() ? prepared.error.kind : prepared.value).toBe(
      VaultStorageFailureKind.GenerationChanged,
    )
    expect(fixture.manager.export_event_log_records_js).not.toHaveBeenCalled()
  })

  test('does not deliver after the prepared generation is replaced', async () => {
    const fixture = ExtensionApprovalTestFixture.create()
    const deliver = vi.spyOn(
      extensionConnectionBrowser,
      'deliverExtensionPairingApproval',
    )
    const approval = new ExtensionVaultApproval(fixture.vault, request)
    const authorized = await approval.authorize()
    expect(authorized.isOk()).toBe(true)
    const prepared = await approval.prepareAuthorizedGrant()
    expect(prepared.isOk()).toBe(true)
    if (prepared.isErr()) return
    fixture.admitManager.mockReturnValue(
      err(new VaultStorageFailure(VaultStorageFailureKind.GenerationChanged)),
    )

    const delivered = await approval.deliver(prepared.value)

    expect(delivered.isErr() ? delivered.error.kind : delivered.value).toBe(
      VaultStorageFailureKind.GenerationChanged,
    )
    expect(deliver).not.toHaveBeenCalled()
  })
})
