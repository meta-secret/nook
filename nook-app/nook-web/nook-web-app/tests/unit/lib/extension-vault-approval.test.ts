import { err, ok, type Result } from 'neverthrow'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const wasm = vi.hoisted(() => ({
  approveExtensionDevice: vi.fn(),
}))

vi.mock('$app-wasm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$app-wasm')>()),
  approve_extension_device: wasm.approveExtensionDevice,
  classify_vault_recovery_error: () => 'other',
  VaultRecoveryErrorKind: { Other: 'other' },
}))

vi.mock('$lib/auth/providers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/auth/providers')>()),
  activeVaultScope: vi.fn(),
  providerBelongsToVault: vi.fn(),
  seal_auth_providers_for_device_public_key: vi.fn(),
}))

import {
  NookVaultManager,
  type NookEventLogRecords,
} from '../../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
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
  wasm.approveExtensionDevice.mockImplementation(async () => {})
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
    expect(fixture.manager.export_event_log_records_js).not.toHaveBeenCalled()
    const prepared = await approval.prepareAuthorizedGrant()
    expect(prepared.isOk()).toBe(true)
    if (prepared.isErr()) return
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
