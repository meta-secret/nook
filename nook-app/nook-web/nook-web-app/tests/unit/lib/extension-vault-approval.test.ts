import { err, ok } from 'neverthrow'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const wasm = vi.hoisted(() => ({
  approveExtensionDevice: vi.fn(),
}))

vi.mock('$app-wasm', () => ({
  approve_extension_device: wasm.approveExtensionDevice,
}))

vi.mock('$lib/auth/providers', () => ({
  activeVaultScope: vi.fn(),
  providerBelongsToVault: vi.fn(),
  seal_auth_providers_for_device_public_key: vi.fn(),
}))

import type { NookVaultManager } from '$app-wasm'
import {
  ExtensionConnectScope,
  ExtensionIdentityRequestSource,
  ExtensionPairingDeliveryKind,
  extensionConnectionBrowser,
  type ExtensionConnectRequest,
} from '$lib/extension/connect'
import { ExtensionVaultApproval } from '$lib/extension/vault-approval'
import {
  VaultStorageFailure,
  VaultStorageFailureKind,
} from '$lib/runtime/storage-failure'
import { ActiveVaultKind } from '$lib/vault/state/provider.svelte'
import type { VaultState } from '$lib/vault.svelte'

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

function approvalFixture() {
  const records = {
    to_array: vi.fn(() => []),
    free: vi.fn(),
  }
  const manager = {
    vaultStoreId: 'store-1',
    export_event_log_records_js: vi.fn(async () => records),
  } as unknown as NookVaultManager
  const admitManager = vi.fn(() => ok(manager))
  const vault = {
    activeVault: { kind: ActiveVaultKind.Open, storeId: 'store-1' },
    admitManager,
    enqueueStorage: (operation: () => unknown) => operation(),
    localVaults: [],
    t: vi.fn(() => 'Unnamed vault'),
  } as unknown as VaultState
  return { admitManager, manager, records, vault }
}

beforeEach(() => {
  vi.restoreAllMocks()
  wasm.approveExtensionDevice.mockResolvedValue()
})

describe('extension vault approval', () => {
  test('authorizes, exports, and delivers one generation-consistent grant', async () => {
    const fixture = approvalFixture()
    const deliver = vi
      .spyOn(extensionConnectionBrowser, 'deliverExtensionPairingApproval')
      .mockResolvedValue({ kind: ExtensionPairingDeliveryKind.Delivered })
    const approval = new ExtensionVaultApproval(fixture.vault, request)

    const prepared = await approval.prepare()
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

  test('returns native authorization failures before exporting records', async () => {
    const fixture = approvalFixture()
    wasm.approveExtensionDevice.mockRejectedValueOnce(
      new Error('authorization rejected'),
    )

    const prepared = await new ExtensionVaultApproval(
      fixture.vault,
      request,
    ).prepare()

    expect(prepared.isErr()).toBe(true)
    expect(fixture.manager.export_event_log_records_js).not.toHaveBeenCalled()
  })

  test('rejects a manager generation change between authorization and export', async () => {
    const fixture = approvalFixture()
    const replacement = {} as NookVaultManager
    fixture.admitManager
      .mockReturnValueOnce(ok(fixture.manager))
      .mockReturnValueOnce(ok(fixture.manager))
      .mockReturnValueOnce(ok(replacement))

    const prepared = await new ExtensionVaultApproval(
      fixture.vault,
      request,
    ).prepare()

    expect(prepared.isErr() ? prepared.error.kind : prepared.value).toBe(
      VaultStorageFailureKind.GenerationChanged,
    )
    expect(fixture.manager.export_event_log_records_js).not.toHaveBeenCalled()
  })

  test('does not deliver after the prepared generation is replaced', async () => {
    const fixture = approvalFixture()
    const deliver = vi.spyOn(
      extensionConnectionBrowser,
      'deliverExtensionPairingApproval',
    )
    const approval = new ExtensionVaultApproval(fixture.vault, request)
    const prepared = await approval.prepare()
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
