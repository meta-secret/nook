import { ok } from 'neverthrow'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  DeviceProtectionStatus,
  NookVaultManager,
  type EventLogStorageRecord,
  type IdentityControlSnapshot,
  type NookEventLogRecords,
  type NookKeyringProviderShares,
} from '$app-wasm'
import { ExtensionConnectFollowKind } from '$web-shared/extension/extension-connect-progress'
import {
  ExtensionPairingApprovedMessageType,
  type ExtensionPairingApprovedMessage,
} from '$web-shared/extension/runtime-messages'
import {
  ExtensionConnectScope,
  ExtensionPairingDeliveryKind,
  extensionConnectionBrowser,
  type ExtensionConnectRequest,
} from '$lib/extension/connect'
import { ExtensionKeyringApproval } from '$lib/extension/keyring-approval'
import { VaultStorageFailureKind } from '$lib/runtime/storage-failure'
import type { VaultState } from '$lib/vault.svelte'
import {
  IdentityActionOutcome,
  IdentityControlViewKind,
} from '$lib/vault/identity-control.svelte'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import { VaultStateTestFixture } from '../vault-state-test-fixture'

const approvedAt = 1_783_373_640_000

const request: ExtensionConnectRequest = {
  follow: { kind: ExtensionConnectFollowKind.Unnamed },
  deviceId: 'device-1',
  devicePublicKey: 'age1device',
  deviceSigningPublicKey: 'signing-key',
  extensionRuntimeId: 'extension-123',
  deviceLabel: 'Nook Extension',
  scopes: [ExtensionConnectScope.VaultAccess],
}

const syncRequest: ExtensionConnectRequest = {
  ...request,
  scopes: [
    ExtensionConnectScope.VaultAccess,
    ExtensionConnectScope.SyncProviderCredentials,
  ],
}

const personalRecords: EventLogStorageRecord[] = [
  {
    eventId: 'event-1',
    event: {
      schema_version: 2,
      store_id: 'store_personal0',
      actor_id: `key_${'0'.repeat(64)}`,
      actor_signing_public_key: '0'.repeat(64),
      parents: [],
      created_at: '2026-07-07T00:00:00.000Z',
      key_epoch: 'sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo',
      operations: [{ type: 'vault-cleared' }],
      signature: `ed25519:${'0'.repeat(128)}`,
    },
  },
]

/** The keyring's providers, sealed in Rust to each of its other apps. */
const sealedProviders: NookKeyringProviderShares = {
  apps: [{ appId: 'app-extension', providers: [] }],
}

/** A vault of the keyring, with the records this browser holds for it. */
type HeldVault = {
  readonly storeId: string
  readonly records: EventLogStorageRecord[]
}

function keyringSnapshot(
  identityId: string,
  storeIds: readonly string[],
): IdentityControlSnapshot {
  return {
    identityId,
    identityLabel: 'Personal',
    standing: 'member',
    members: [{ appId: 'app-web', label: 'Web', isCurrentInstallation: true }],
    joinRequests: [],
    vaults: storeIds.map((storeId) => ({
      storeId,
      grantedToCurrentInstallation: true,
      membersMissingDek: [],
    })),
    mounts: [],
  }
}

/**
 * The keyring unlocked on this browser with no vault open: its engine adds
 * members and exports the log and the records of the vaults it holds.
 */
class UnlockedKeyringFixture {
  readonly vault: VaultState = VaultStateTestFixture.create()
  readonly manager = new NookVaultManager()
  /** What the approval did to the keyring, in order. */
  readonly steps: string[] = []
  /** Store IDs whose exported records handle was freed. */
  readonly freed: string[] = []
  private keyring: IdentityControlSnapshot

  constructor(held: readonly HeldVault[]) {
    this.keyring = keyringSnapshot(
      'identity-1',
      held.map(({ storeId }) => storeId),
    )
    const records = new Map(held.map((vault) => [vault.storeId, vault.records]))
    const vault = this.vault
    vault.openManager(this.manager)
    vault.deviceProtectionStatus = DeviceProtectionStatus.Unlocked
    VaultStateTestFixture.runStorageImmediately(vault)
    const project = (step: string) => async () => {
      this.steps.push(step)
      this.project()
      return ok(IdentityActionOutcome.Completed)
    }
    vi.spyOn(vault.identityControl, 'refresh').mockImplementation(
      project('keyring log ensured'),
    )
    vi.spyOn(vault.identityControl, 'syncWithMounts').mockImplementation(
      project('keyring change published'),
    )
    vi.spyOn(this.manager, 'add_identity_member').mockImplementation(
      async () => {
        this.steps.push('extension added')
        return true
      },
    )
    vi.spyOn(this.manager, 'export_identity_log').mockImplementation(
      async () => ({
        identityId: this.keyring.identityId,
        events: ['identity-event-1'],
      }),
    )
    vi.spyOn(
      this.manager,
      'export_vault_event_log_records_js',
    ).mockImplementation(async (storeId) => {
      const handle = {
        to_array: () => {
          const held = records.get(storeId)
          return held ? held : []
        },
        free: () => {
          this.freed.push(storeId)
        },
        [Symbol.dispose]: () => {},
      } satisfies NookEventLogRecords
      return handle
    })
    vi.spyOn(this.manager, 'keyring_provider_shares').mockResolvedValue(
      sealedProviders,
    )
  }

  /** Another keyring is unlocked on this browser now. */
  switchKeyring(identityId: string): void {
    this.keyring = keyringSnapshot(identityId, [])
    this.project()
  }

  private project(): void {
    this.vault.identityControl.view = {
      kind: IdentityControlViewKind.Ready,
      snapshot: this.keyring,
    }
  }
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(approvedAt)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('approving the extension into the keyring', () => {
  test('adds the extension to the unlocked keyring while no vault is open', async () => {
    const fixture = new UnlockedKeyringFixture([
      { storeId: 'store_personal0', records: personalRecords },
    ])
    expect(fixture.vault.isAuthenticated).toBe(false)
    expect(fixture.vault.hasActiveVaultStore).toBe(false)
    const approval = new ExtensionKeyringApproval(fixture.vault, request)

    const member = await approval.authorize()

    expect(member._unsafeUnwrap()).toEqual({ identityId: 'identity-1' })
    expect(fixture.manager.add_identity_member).toHaveBeenCalledWith(
      request.deviceId,
      request.devicePublicKey,
      request.deviceSigningPublicKey,
      request.deviceLabel,
    )
    // The keyring's log exists before the extension joins it, and its
    // providers carry the new member afterwards.
    expect(fixture.steps).toEqual([
      'keyring log ensured',
      'extension added',
      'keyring change published',
    ])

    const prepared = await approval.prepareAuthorizedGrant()

    const expected: ExtensionPairingApprovedMessage = {
      type: ExtensionPairingApprovedMessageType.NookExtensionPairingApproved,
      payload: {
        deviceId: request.deviceId,
        devicePublicKey: request.devicePublicKey,
        deviceSigningPublicKey: request.deviceSigningPublicKey,
        deviceLabel: request.deviceLabel,
        approvedAt,
        scopes: [ExtensionConnectScope.VaultAccess],
        identityId: 'identity-1',
        identityLabel: 'Personal',
        identityEvents: ['identity-event-1'],
        vaults: [
          { storeId: 'store_personal0', eventLogRecords: personalRecords },
        ],
        providers: { apps: [] },
      },
    }
    // Nothing in the approval is tied to one vault.
    expect(prepared._unsafeUnwrap()).toEqual(expected)
    expect(fixture.freed).toEqual(['store_personal0'])
  })

  test('registers the open vault in the keyring before adding the extension', async () => {
    const fixture = new UnlockedKeyringFixture([
      { storeId: 'store_personal0', records: personalRecords },
    ])
    fixture.vault.isAuthenticated = true
    vi.spyOn(
      fixture.vault.identityControl,
      'followOpenVault',
    ).mockImplementation(async () => {
      fixture.steps.push('open vault registered')
      return ok(IdentityActionOutcome.Completed)
    })
    const approval = new ExtensionKeyringApproval(fixture.vault, request)

    expect((await approval.authorize()).isOk()).toBe(true)

    // The extension is added with the open vault's DEK, and the hand-over
    // lists that vault.
    expect(fixture.steps).toEqual([
      'open vault registered',
      'extension added',
      'keyring change published',
    ])
  })

  test('hands over a keyring with no vault yet as an empty vault list', async () => {
    const fixture = new UnlockedKeyringFixture([])
    const approval = new ExtensionKeyringApproval(fixture.vault, request)
    expect((await approval.authorize()).isOk()).toBe(true)

    const prepared = await approval.prepareAuthorizedGrant()

    const payload = prepared._unsafeUnwrap().payload
    expect(payload.vaults).toEqual([])
    expect(payload.identityId).toBe('identity-1')
    expect(payload.identityEvents).toEqual(['identity-event-1'])
    expect(
      fixture.manager.export_vault_event_log_records_js,
    ).not.toHaveBeenCalled()
  })

  test('hands over only the vaults this browser holds records for', async () => {
    const fixture = new UnlockedKeyringFixture([
      { storeId: 'store_personal0', records: personalRecords },
      { storeId: 'store_work00000', records: [] },
    ])
    const approval = new ExtensionKeyringApproval(fixture.vault, request)
    expect((await approval.authorize()).isOk()).toBe(true)

    const prepared = await approval.prepareAuthorizedGrant()

    // The vault with no records here reaches the extension through the
    // keyring's sync providers.
    expect(prepared._unsafeUnwrap().payload.vaults).toEqual([
      { storeId: 'store_personal0', eventLogRecords: personalRecords },
    ])
    expect(fixture.freed).toEqual(['store_personal0', 'store_work00000'])
  })

  test.each([
    {
      name: 'shares no providers when the extension did not ask for them',
      connect: request,
      providers: { apps: [] },
      asked: 0,
    },
    {
      name: 'shares the sealed keyring providers when the extension asked for them',
      connect: syncRequest,
      providers: sealedProviders,
      asked: 1,
    },
  ])('$name', async ({ connect, providers, asked }) => {
    const fixture = new UnlockedKeyringFixture([])
    const approval = new ExtensionKeyringApproval(fixture.vault, connect)
    expect((await approval.authorize()).isOk()).toBe(true)

    const prepared = await approval.prepareAuthorizedGrant()

    const payload = prepared._unsafeUnwrap().payload
    expect(payload.providers).toEqual(providers)
    expect(payload.scopes).toEqual(connect.scopes)
    expect(fixture.manager.keyring_provider_shares).toHaveBeenCalledTimes(asked)
  })

  test('adds the extension once however often authorization is asked for', async () => {
    const fixture = new UnlockedKeyringFixture([])
    const approval = new ExtensionKeyringApproval(fixture.vault, request)

    const first = await approval.authorize()
    const second = await approval.authorize()

    expect(second._unsafeUnwrap()).toEqual(first._unsafeUnwrap())
    expect(fixture.manager.add_identity_member).toHaveBeenCalledOnce()
  })

  test('an engine failure while adding the extension hands nothing over', async () => {
    const fixture = new UnlockedKeyringFixture([])
    vi.mocked(fixture.manager.add_identity_member).mockRejectedValueOnce(
      new Error('member rejected'),
    )
    const approval = new ExtensionKeyringApproval(fixture.vault, request)

    const member = await approval.authorize()

    expect(member.isErr()).toBe(true)
    expect(fixture.vault.identityControl.syncWithMounts).not.toHaveBeenCalled()
    const prepared = await approval.prepareAuthorizedGrant()
    expect(prepared.isErr() ? prepared.error.kind : prepared.value).toBe(
      VaultStorageFailureKind.ExtensionApprovalContextChanged,
    )
    expect(fixture.manager.export_identity_log).not.toHaveBeenCalled()
  })
})

describe('an approval whose keyring changed meanwhile', () => {
  test('fails before adding the extension when another engine opened', async () => {
    const fixture = new UnlockedKeyringFixture([])
    const approval = new ExtensionKeyringApproval(fixture.vault, request)
    fixture.vault.openManager(new NookVaultManager())

    const member = await approval.authorize()

    expect(member.isErr() ? member.error.kind : member.value).toBe(
      VaultStorageFailureKind.ExtensionApprovalContextChanged,
    )
    if (member.isErr()) {
      expect(member.error.translationKey).toBe(
        I18N_KEYS.ExtensionConsentApprovalFailed,
      )
    }
    expect(fixture.manager.add_identity_member).not.toHaveBeenCalled()
  })

  test('adds the extension to no other keyring when another engine opens while the log refreshes', async () => {
    const fixture = new UnlockedKeyringFixture([])
    const approval = new ExtensionKeyringApproval(fixture.vault, request)
    const replacement = new NookVaultManager()
    const replacementAdd = vi
      .spyOn(replacement, 'add_identity_member')
      .mockResolvedValue(true)
    vi.mocked(fixture.vault.identityControl.refresh).mockImplementation(
      async () => {
        fixture.vault.openManager(replacement)
        return ok(IdentityActionOutcome.Completed)
      },
    )

    const member = await approval.authorize()

    expect(member.isErr() ? member.error.kind : member.value).toBe(
      VaultStorageFailureKind.ExtensionApprovalContextChanged,
    )
    expect(replacementAdd).not.toHaveBeenCalled()
    expect(fixture.manager.add_identity_member).not.toHaveBeenCalled()
  })

  test('hands nothing over when the engine changed after the extension was added', async () => {
    const fixture = new UnlockedKeyringFixture([
      { storeId: 'store_personal0', records: personalRecords },
    ])
    const approval = new ExtensionKeyringApproval(fixture.vault, request)
    expect((await approval.authorize()).isOk()).toBe(true)
    const replacement = new NookVaultManager()
    const replacementLog = vi.spyOn(replacement, 'export_identity_log')
    fixture.vault.openManager(replacement)

    const prepared = await approval.prepareAuthorizedGrant()

    expect(prepared.isErr() ? prepared.error.kind : prepared.value).toBe(
      VaultStorageFailureKind.ExtensionApprovalContextChanged,
    )
    expect(fixture.manager.export_identity_log).not.toHaveBeenCalled()
    expect(replacementLog).not.toHaveBeenCalled()
    const completion = approval.admitCompletion()
    expect(completion.isErr() ? completion.error.kind : completion.value).toBe(
      VaultStorageFailureKind.ExtensionApprovalContextChanged,
    )
  })

  test('hands nothing over when another keyring was switched to after the extension was added', async () => {
    const fixture = new UnlockedKeyringFixture([
      { storeId: 'store_personal0', records: personalRecords },
    ])
    const approval = new ExtensionKeyringApproval(fixture.vault, request)
    expect((await approval.authorize()).isOk()).toBe(true)
    fixture.switchKeyring('identity-2')

    const prepared = await approval.prepareAuthorizedGrant()

    expect(prepared.isErr() ? prepared.error.kind : prepared.value).toBe(
      VaultStorageFailureKind.ExtensionApprovalContextChanged,
    )
    expect(fixture.manager.export_identity_log).not.toHaveBeenCalled()
    expect(
      fixture.manager.export_vault_event_log_records_js,
    ).not.toHaveBeenCalled()
  })

  test('refuses a keyring log that belongs to another keyring', async () => {
    const fixture = new UnlockedKeyringFixture([
      { storeId: 'store_personal0', records: personalRecords },
    ])
    const approval = new ExtensionKeyringApproval(fixture.vault, request)
    expect((await approval.authorize()).isOk()).toBe(true)
    vi.mocked(fixture.manager.export_identity_log).mockResolvedValueOnce({
      identityId: 'identity-2',
      events: ['identity-event-2'],
    })

    const prepared = await approval.prepareAuthorizedGrant()

    expect(prepared.isErr() ? prepared.error.kind : prepared.value).toBe(
      VaultStorageFailureKind.ExtensionApprovalContextChanged,
    )
    expect(
      fixture.manager.export_vault_event_log_records_js,
    ).not.toHaveBeenCalled()
  })

  test('a released approval hands nothing over and cannot authorize again', async () => {
    const fixture = new UnlockedKeyringFixture([])
    const approval = new ExtensionKeyringApproval(fixture.vault, request)
    expect((await approval.authorize()).isOk()).toBe(true)

    approval.releaseAuthorization()

    const prepared = await approval.prepareAuthorizedGrant()
    expect(prepared.isErr() ? prepared.error.kind : prepared.value).toBe(
      VaultStorageFailureKind.ExtensionApprovalContextChanged,
    )
    const again = await approval.authorize()
    expect(again.isErr() ? again.error.kind : again.value).toBe(
      VaultStorageFailureKind.ExtensionApprovalContextChanged,
    )
    expect(fixture.manager.add_identity_member).toHaveBeenCalledOnce()
  })
})

describe('delivering the keyring approval', () => {
  test('delivers the prepared approval to the extension that asked', async () => {
    const fixture = new UnlockedKeyringFixture([])
    const deliver = vi
      .spyOn(extensionConnectionBrowser, 'deliverExtensionPairingApproval')
      .mockResolvedValue({
        kind: ExtensionPairingDeliveryKind.Delivered,
        eventCount: 1,
      })
    const approval = new ExtensionKeyringApproval(fixture.vault, request)
    expect((await approval.authorize()).isOk()).toBe(true)
    const message = (await approval.prepareAuthorizedGrant())._unsafeUnwrap()

    const delivered = await approval.deliver(message)

    expect(delivered._unsafeUnwrap()).toEqual({
      kind: ExtensionPairingDeliveryKind.Delivered,
      eventCount: 1,
    })
    expect(deliver).toHaveBeenCalledWith({ request, message })
    expect(approval.admitCompletion()._unsafeUnwrap().manager).toBe(
      fixture.manager,
    )
  })

  test('does not deliver once the keyring locked', async () => {
    const fixture = new UnlockedKeyringFixture([])
    const deliver = vi.spyOn(
      extensionConnectionBrowser,
      'deliverExtensionPairingApproval',
    )
    const approval = new ExtensionKeyringApproval(fixture.vault, request)
    expect((await approval.authorize()).isOk()).toBe(true)
    const message = (await approval.prepareAuthorizedGrant())._unsafeUnwrap()
    fixture.vault.clearManager()

    const delivered = await approval.deliver(message)

    expect(delivered.isErr() ? delivered.error.kind : delivered.value).toBe(
      VaultStorageFailureKind.ManagerUnavailable,
    )
    expect(deliver).not.toHaveBeenCalled()
  })
})
