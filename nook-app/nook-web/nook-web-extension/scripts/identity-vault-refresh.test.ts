import { beforeAll, describe, expect, test } from 'bun:test'
import { ok } from 'neverthrow'
import initNookWasm, {
  configure_vault_application,
  VaultApplication,
} from '../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import { companionWasmReady } from '../../nook-web-shared/src/extension/companion-ready'
import type { ExtensionEventLogRecord } from '../../nook-web-shared/src/extension/lifecycle-runtime-messages'
import { ExtensionConnectScope } from '../../nook-web-shared/src/extension/extension-connect-scope'
import type {
  StoredExtensionKeyring,
  StoredExtensionPairingGrant,
} from '../src/background/pairing-grants'
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
  // The session's vault replies carry records the companion runtime admits.
  await companionWasmReady
})

const EXTENSION_DEVICE = 'device-family'
const KEYRING_APPROVED_AT = 1_792_050_000_000

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

/** A keyring the extension joined under the app key `deviceId`. */
function keyring(
  deviceId: string,
  identityLabel: string,
): StoredExtensionKeyring {
  return {
    identityId: `identity-${identityLabel.toLowerCase()}`,
    identityLabel,
    deviceId,
    devicePublicKey: `age1${deviceId}`,
    deviceSigningPublicKey: `${deviceId}-signing`,
    deviceLabel: 'Nook Extension - Chrome',
    approvedAt: KEYRING_APPROVED_AT,
    scopes: [
      ExtensionConnectScope.VaultAccess,
      ExtensionConnectScope.SyncProviderCredentials,
    ],
  }
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
    scopes: [ExtensionConnectScope.PasswordFilling],
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

type RefreshState = {
  readonly keyrings: StoredExtensionKeyring[]
  readonly grants: StoredExtensionPairingGrant[]
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

  refresh({ keyrings, grants }: RefreshState) {
    const request: IdentityVaultRefreshRequest = {
      deviceId: EXTENSION_DEVICE,
      keyrings,
      grants,
      importVault: this.importVault,
      sendSessionMessage: this.send,
    }
    return new IdentityVaultRefresh(request).refresh()
  }
}

describe('pairing the vaults a keyring gained, on unlock', () => {
  test('pairs each vault the keyring grants and the extension lacks', async () => {
    const fixture = new RefreshFixture(RefreshAnswer.Plan, true)

    const result = await fixture.refresh({
      keyrings: [keyring(EXTENSION_DEVICE, 'Family')],
      grants: [
        grant('store_aaaaaaaaaaa', EXTENSION_DEVICE),
        grant('store_eeeeeeeeeee', 'device-work'),
      ],
    })

    expect(result).toEqual({ ok: true, paired: 2, awaitingGrant: 1 })
    const [refresh, firstConnect, secondConnect, resync, ...rest] = fixture.sent
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
      source: { kind: 'mount', mountProviderId: 'github-family' },
    })
    expect(secondConnect?.payload).toMatchObject({
      vaultStoreId: 'store_nnnnnnnnnnn',
    })
    // The vault the extension already holds is read again through the
    // keyring's provider, so it syncs without the web app open.
    expect(resync?.payload).toMatchObject({
      vaultStoreId: 'store_aaaaaaaaaaa',
      source: { kind: 'mount', mountProviderId: 'github-family' },
    })
    expect(fixture.imported).toHaveLength(3)
    const [later] = fixture.imported
    // The vault pairs under the extension's app in the keyring: its key,
    // its approval and its scopes, not those of a vault grant.
    expect(later?.grant).toEqual({
      vaultType: 'simple',
      deviceId: EXTENSION_DEVICE,
      devicePublicKey: `age1${EXTENSION_DEVICE}`,
      deviceSigningPublicKey: `${EXTENSION_DEVICE}-signing`,
      deviceLabel: 'Nook Extension - Chrome',
      vaultStoreId: 'store_lllllllllll',
      vaultName: 'Later vault',
      identityLabel: 'Family',
      approvedAt: KEYRING_APPROVED_AT,
      scopes: [
        ExtensionConnectScope.VaultAccess,
        ExtensionConnectScope.SyncProviderCredentials,
      ],
      syncProviderCount: 1,
    })
    expect(later?.eventLogRecords.map((each) => each.eventId)).toEqual([
      record.eventId,
    ])
  })

  test('a keyring joined with no vault pairs its vaults on unlock', async () => {
    const fixture = new RefreshFixture(RefreshAnswer.Plan, true)

    const result = await fixture.refresh({
      keyrings: [keyring(EXTENSION_DEVICE, 'Family')],
      grants: [],
    })

    expect(result).toEqual({ ok: true, paired: 2, awaitingGrant: 1 })
    const [refresh, ...connects] = fixture.sent
    expect(refresh?.payload).toMatchObject({ pairedVaultStoreIds: [] })
    expect(connects.map((message) => message.type)).toEqual([
      ExtensionSessionMessageType.ConnectIdentityVault,
      ExtensionSessionMessageType.ConnectIdentityVault,
    ])
    expect(fixture.imported.map((each) => each.grant.vaultStoreId)).toEqual([
      'store_lllllllllll',
      'store_nnnnnnnnnnn',
    ])
  })

  test('pairs under the keyring whose app key unlocked', async () => {
    const fixture = new RefreshFixture(RefreshAnswer.Plan, true)

    await fixture.refresh({
      keyrings: [
        keyring('device-work', 'Acme'),
        keyring(EXTENSION_DEVICE, 'Family'),
      ],
      grants: [],
    })

    expect(
      fixture.imported.map((each) => [
        each.grant.deviceId,
        each.grant.identityLabel,
      ]),
    ).toEqual([
      [EXTENSION_DEVICE, 'Family'],
      [EXTENSION_DEVICE, 'Family'],
    ])
  })

  test('a key that joined no keyring asks the session nothing', async () => {
    const fixture = new RefreshFixture(RefreshAnswer.Plan, true)

    const result = await fixture.refresh({
      keyrings: [keyring('device-work', 'Acme')],
      grants: [grant('store_wwwwwwwwwww', EXTENSION_DEVICE)],
    })

    expect(result).toEqual({ ok: true, paired: 0, awaitingGrant: 0 })
    expect(fixture.sent).toHaveLength(0)
    expect(fixture.imported).toHaveLength(0)
  })

  test('reports vaults not shared with the extension yet', async () => {
    const fixture = new RefreshFixture(RefreshAnswer.NothingToPair, true)

    const result = await fixture.refresh({
      keyrings: [keyring(EXTENSION_DEVICE, 'Family')],
      grants: [grant('store_aaaaaaaaaaa', EXTENSION_DEVICE)],
    })

    expect(result).toEqual({ ok: true, paired: 0, awaitingGrant: 1 })
    expect(fixture.imported).toHaveLength(0)
  })

  test('a refresh the session cannot finish is reported', async () => {
    const fixture = new RefreshFixture(RefreshAnswer.Refused, true)

    const result = await fixture.refresh({
      keyrings: [keyring(EXTENSION_DEVICE, 'Family')],
      grants: [grant('store_aaaaaaaaaaa', EXTENSION_DEVICE)],
    })

    expect(result).toEqual({
      ok: false,
      reason: IdentityVaultRefreshFailure.RefreshFailed,
    })
    expect(fixture.imported).toHaveLength(0)
  })

  test('a vault that does not open stops the refresh with that failure', async () => {
    const fixture = new RefreshFixture(RefreshAnswer.Plan, false)

    const result = await fixture.refresh({
      keyrings: [keyring(EXTENSION_DEVICE, 'Family')],
      grants: [grant('store_aaaaaaaaaaa', EXTENSION_DEVICE)],
    })

    expect(result).toEqual({
      ok: false,
      reason: IdentityVaultPairingFailure.VaultConnectFailed,
    })
    expect(fixture.sent).toHaveLength(2)
    expect(fixture.imported).toHaveLength(0)
  })
})
