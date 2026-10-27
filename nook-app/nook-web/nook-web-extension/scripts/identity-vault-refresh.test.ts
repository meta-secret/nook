import { beforeAll, describe, expect, test } from 'bun:test'
import { ok } from 'neverthrow'
import initNookWasm, {
  configure_vault_application,
  VaultApplication,
} from '../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import type { ExtensionEventLogRecord } from '../../nook-web-shared/src/extension/lifecycle-runtime-messages'
import { ExtensionConnectScope } from '../../nook-web-shared/src/extension/extension-connect-scope'
import { ExtensionIdentityInviteWireKind } from '../../nook-web-shared/src/extension/identity-invite-wire'
import type { StoredExtensionPairingGrant } from '../src/background/pairing-grants'
import {
  IdentityVaultRefresh,
  IdentityVaultRefreshFailure,
  type IdentityVaultRefreshRequest,
} from '../src/background/service-worker/identity-vault-refresh'
import {
  IdentityVaultPairingFailure,
  type IdentitySessionSend,
  type PairedVaultImport,
  type PairedVaultImportRequest,
} from '../src/background/service-worker/identity-vault-pairing'
import type { SessionMessageRequest } from '../src/background/service-worker/pairing-identity'
import type { ExtensionSessionResponse } from '../src/offscreen/session'
import { ExtensionSessionMessageType } from '../src/lib/extension-session-message-type'
import {
  ExtensionSessionTransportFailure,
  ExtensionSessionTransportFailureKind,
} from '../src/background/service-worker/session-document'

beforeAll(async () => {
  const wasm: Parameters<typeof initNookWasm>[0] = {
    module_or_path: await Bun.file(
      new URL(
        '../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm_bg.wasm',
        import.meta.url,
      ),
    ).arrayBuffer(),
  }
  await initNookWasm(wasm)
  configure_vault_application(VaultApplication.Extension)
})

const EXTENSION_DEVICE = 'device-family'
const NOW = 1_792_100_000_000

const record: ExtensionEventLogRecord = {
  eventId: 'sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo',
  event: {
    schema_version: 2,
    store_id: 'store_lllllllllll',
    actor_id: `key_${'0'.repeat(64)}`,
    actor_signing_public_key: '0'.repeat(64),
    parents: [],
    created_at: '2026-10-16T00:00:00Z',
    key_epoch: 'sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo',
    operations: [],
    signature: `ed25519:${'0'.repeat(128)}`,
  },
}

function grant(
  vaultStoreId: string,
  deviceId: string,
): StoredExtensionPairingGrant {
  return {
    vaultType: 'simple',
    deviceId,
    devicePublicKey: `age1${deviceId}`,
    deviceSigningPublicKey: `${deviceId}-signing`,
    deviceLabel: 'Nook Extension - Chrome',
    vaultStoreId,
    vaultName: 'Approved vault',
    identityLabel: 'Family',
    approvedAt: 1_792_000_000_000,
    scopes: [
      ExtensionConnectScope.VaultAccess,
      ExtensionConnectScope.SyncProviderCredentials,
    ],
    syncProviderCount: 1,
    eventCount: 4,
    eventLogHeads: [],
    lastLocalSyncAt: '',
  }
}

enum RefreshAnswer {
  Plan = 'plan',
  NothingToPair = 'nothing-to-pair',
  Refused = 'refused',
}

/** The offscreen session and the import, as the refresh drives them. */
class RefreshFixture {
  readonly sent: SessionMessageRequest[0][] = []
  readonly imported: PairedVaultImportRequest[] = []
  constructor(
    private readonly answer: RefreshAnswer,
    private readonly connectSucceeds: boolean,
  ) {}

  readonly send: IdentitySessionSend = (...request) => {
    const [message] = request
    this.sent.push(message)
    if (message.type === ExtensionSessionMessageType.RefreshIdentityVaults) {
      if (this.answer === RefreshAnswer.Refused) {
        const failure = new ExtensionSessionTransportFailure(
          ExtensionSessionTransportFailureKind.DeliveryFailed,
        )
        return Promise.resolve(failure.toResult<ExtensionSessionResponse>())
      }
      const planned: ExtensionSessionResponse = {
        ok: true,
        standing: 'member',
        identityLabel: 'Extension',
        toPair:
          this.answer === RefreshAnswer.Plan
            ? ['store_lllllllllll', 'store_nnnnnnnnnnn']
            : [],
        awaitingGrant: ['store_uuuuuuuuuuu'],
        mountProviderIds:
          this.answer === RefreshAnswer.Plan ? ['github-family'] : [],
      }
      return Promise.resolve(ok(planned))
    }
    if (!this.connectSucceeds) {
      const refused: ExtensionSessionResponse = { ok: false, reason: 'failed' }
      return Promise.resolve(ok(refused))
    }
    const connected: ExtensionSessionResponse = {
      ok: true,
      vaultName: 'Later vault',
      eventLogRecords: [record],
    }
    return Promise.resolve(ok(connected))
  }

  readonly importVault: PairedVaultImport = (request) => {
    this.imported.push(request)
    return Promise.resolve({ ok: true as const, eventCount: 2 })
  }

  refresh(grants: StoredExtensionPairingGrant[]) {
    const request: IdentityVaultRefreshRequest = {
      deviceId: EXTENSION_DEVICE,
      grants,
      importVault: this.importVault,
      sendSessionMessage: this.send,
      now: () => NOW,
    }
    return new IdentityVaultRefresh(request).refresh()
  }
}

describe('pairing the vaults an identity gained, on unlock', () => {
  test('pairs each vault the identity grants and the extension lacks', async () => {
    const fixture = new RefreshFixture(RefreshAnswer.Plan, true)

    const result = await fixture.refresh([
      grant('store_aaaaaaaaaaa', EXTENSION_DEVICE),
      grant('store_eeeeeeeeeee', 'device-work'),
    ])

    expect(result).toEqual({ ok: true, paired: 2, awaitingGrant: 1 })
    const [refresh, firstConnect, secondConnect, ...rest] = fixture.sent
    expect(rest).toHaveLength(0)
    expect(refresh?.type).toBe(
      ExtensionSessionMessageType.RefreshIdentityVaults,
    )
    // Every paired vault counts, under any of the extension's keys.
    expect(refresh?.payload).toMatchObject({
      pairedVaultStoreIds: ['store_aaaaaaaaaaa', 'store_eeeeeeeeeee'],
    })
    expect(firstConnect?.payload).toMatchObject({
      vaultStoreId: 'store_lllllllllll',
      mountProviderId: 'github-family',
    })
    expect(secondConnect?.payload).toMatchObject({
      vaultStoreId: 'store_nnnnnnnnnnn',
    })
    const [later] = fixture.imported
    expect(fixture.imported).toHaveLength(2)
    // No credential travels: the session keeps the identity's provider.
    expect(later?.providers).toEqual([])
    expect(later?.syncProviderCount).toBe(1)
    expect(later?.message.payload).toMatchObject({
      vaultStoreId: 'store_lllllllllll',
      vaultName: 'Later vault',
      identityLabel: 'Family',
      deviceId: EXTENSION_DEVICE,
      approvedAt: NOW,
      scopes: [
        ExtensionConnectScope.VaultAccess,
        ExtensionConnectScope.SyncProviderCredentials,
      ],
      identityInvite: { kind: ExtensionIdentityInviteWireKind.NotOffered },
    })
  })

  test('a key with no vault yet asks the session nothing', async () => {
    const fixture = new RefreshFixture(RefreshAnswer.Plan, true)

    const result = await fixture.refresh([
      grant('store_wwwwwwwwwww', 'device-work'),
    ])

    expect(result).toEqual({ ok: true, paired: 0, awaitingGrant: 0 })
    expect(fixture.sent).toHaveLength(0)
  })

  test('reports vaults not shared with the extension yet', async () => {
    const fixture = new RefreshFixture(RefreshAnswer.NothingToPair, true)

    const result = await fixture.refresh([
      grant('store_aaaaaaaaaaa', EXTENSION_DEVICE),
    ])

    expect(result).toEqual({ ok: true, paired: 0, awaitingGrant: 1 })
    expect(fixture.imported).toHaveLength(0)
  })

  test('a refresh the session cannot finish is reported', async () => {
    const fixture = new RefreshFixture(RefreshAnswer.Refused, true)

    const result = await fixture.refresh([
      grant('store_aaaaaaaaaaa', EXTENSION_DEVICE),
    ])

    expect(result).toEqual({
      ok: false,
      reason: IdentityVaultRefreshFailure.RefreshFailed,
    })
    expect(fixture.imported).toHaveLength(0)
  })

  test('a vault that does not open stops the refresh with that failure', async () => {
    const fixture = new RefreshFixture(RefreshAnswer.Plan, false)

    const result = await fixture.refresh([
      grant('store_aaaaaaaaaaa', EXTENSION_DEVICE),
    ])

    expect(result).toEqual({
      ok: false,
      reason: IdentityVaultPairingFailure.VaultConnectFailed,
    })
    expect(fixture.sent).toHaveLength(2)
    expect(fixture.imported).toHaveLength(0)
  })
})
