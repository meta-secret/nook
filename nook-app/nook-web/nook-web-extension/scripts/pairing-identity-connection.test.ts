import { beforeAll, expect, test } from 'bun:test'
import { ok } from 'neverthrow'
import initNookWasm, {
  configure_vault_application,
  VaultApplication,
} from '../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import type { ExtensionEventLogRecord } from '../../nook-web-shared/src/extension/lifecycle-runtime-messages'
import {
  ExtensionPairingApprovedMessageType,
  type ExtensionPairingApprovedMessage,
} from '../../nook-web-shared/src/extension/runtime-messages'
import { ExtensionConnectScope } from '../../nook-web-shared/src/extension/extension-connect-scope'
import {
  ExtensionIdentityInviteWireKind,
  type ExtensionIdentityInviteWire,
} from '../../nook-web-shared/src/extension/identity-invite-wire'
import {
  PairingIdentityConnection,
  PairingIdentityConnectionFailure,
  type IdentitySessionSend,
  type PairedVaultImport,
  type PairedVaultImportRequest,
  type PairingIdentityConnectionRequest,
} from '../src/background/service-worker/pairing-identity-connection'
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

const APPROVED_STORE = 'store_aaaaaaaaaaa'
const WORK_STORE = 'store_bbbbbbbbbbb'

const record: ExtensionEventLogRecord = {
  eventId: 'sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo',
  path: 'events/work.json',
  event: {
    schema_version: 2,
    store_id: WORK_STORE,
    actor_id: `key_${'0'.repeat(64)}`,
    actor_signing_public_key: '0'.repeat(64),
    parents: [],
    created_at: '2026-10-16T00:00:00Z',
    key_epoch: 'sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo',
    operations: [],
    signature: `ed25519:${'0'.repeat(128)}`,
  },
}

function approval(
  identityInvite: ExtensionIdentityInviteWire,
): ExtensionPairingApprovedMessage {
  const message: ExtensionPairingApprovedMessage = {
    type: ExtensionPairingApprovedMessageType.NookExtensionPairingApproved,
    payload: {
      vaultType: 'simple',
      deviceId: 'device-extension',
      devicePublicKey: 'age1extension',
      deviceSigningPublicKey: 'extension-signing',
      deviceLabel: 'Nook Extension - Chrome',
      vaultStoreId: APPROVED_STORE,
      vaultName: 'Personal vault',
      identityLabel: 'Personal',
      approvedAt: 1_792_000_000_000,
      scopes: [
        ExtensionConnectScope.VaultAccess,
        ExtensionConnectScope.SyncProviderCredentials,
      ],
      providers: [],
      identityInvite,
    },
    eventLogRecords: [record],
  }
  return message
}

const invited: ExtensionIdentityInviteWire = {
  kind: ExtensionIdentityInviteWireKind.Invited,
  identityId: 'identity-personal',
  identityLabel: 'Personal',
  code: 'nook-enroll-code',
  sealedPassphrase: 'age-sealed-passphrase',
  mountProviderId: 'github-1',
}

class SessionFixture {
  readonly sent: SessionMessageRequest[0][] = []
  readonly imported: PairedVaultImportRequest[] = []
  constructor(private readonly joinSucceeds: boolean) {}

  readonly send: IdentitySessionSend = (...request) => {
    const [message] = request
    this.sent.push(message)
    if (message.type === ExtensionSessionMessageType.JoinIdentity) {
      if (!this.joinSucceeds) {
        const failure = new ExtensionSessionTransportFailure(
          ExtensionSessionTransportFailureKind.DeliveryFailed,
        )
        return Promise.resolve(failure.toResult<ExtensionSessionResponse>())
      }
      const joined: ExtensionSessionResponse = {
        ok: true,
        identityId: 'identity-personal',
        identityLabel: 'Personal',
        vaults: [{ storeId: APPROVED_STORE }, { storeId: WORK_STORE }],
      }
      return Promise.resolve(ok(joined))
    }
    const connected: ExtensionSessionResponse = {
      ok: true,
      vaultName: 'Work',
      eventLogRecords: [record],
    }
    return Promise.resolve(ok(connected))
  }

  readonly importVault: PairedVaultImport = (request) => {
    this.imported.push(request)
    const imported = { ok: true as const, eventCount: 5 }
    return Promise.resolve(imported)
  }

  request(
    message: ExtensionPairingApprovedMessage,
  ): PairingIdentityConnectionRequest {
    const connectionRequest: PairingIdentityConnectionRequest = {
      message,
      providers: [],
      importVault: this.importVault,
      sendSessionMessage: this.send,
    }
    return connectionRequest
  }
}

test('an approval without an invite pairs only the approved vault', async () => {
  const fixture = new SessionFixture(true)
  const notOffered: ExtensionIdentityInviteWire = {
    kind: ExtensionIdentityInviteWireKind.NotOffered,
  }
  const result = await new PairingIdentityConnection(
    fixture.request(approval(notOffered)),
  ).connect(3)

  expect(result).toEqual({ ok: true, eventCount: 3 })
  expect(fixture.sent).toHaveLength(0)
  expect(fixture.imported).toHaveLength(0)
})

test('the extension joins the identity and pairs its other vaults', async () => {
  const fixture = new SessionFixture(true)
  const result = await new PairingIdentityConnection(
    fixture.request(approval(invited)),
  ).connect(3)

  expect(result).toEqual({ ok: true, eventCount: 8 })
  const [join, connect, ...rest] = fixture.sent
  expect(rest).toHaveLength(0)
  expect(join?.type).toBe(ExtensionSessionMessageType.JoinIdentity)
  expect(join?.payload).toMatchObject({
    identityId: 'identity-personal',
    memberLabel: 'Nook Extension - Chrome',
    mountProviderId: 'github-1',
  })
  // The approved vault is already paired; only the other one is opened.
  expect(connect?.type).toBe(ExtensionSessionMessageType.ConnectIdentityVault)
  expect(connect?.payload).toMatchObject({ vaultStoreId: WORK_STORE })
  const [work] = fixture.imported
  expect(fixture.imported).toHaveLength(1)
  expect(work?.message.payload).toMatchObject({
    vaultStoreId: WORK_STORE,
    vaultName: 'Work',
    identityLabel: 'Personal',
    deviceId: 'device-extension',
    identityInvite: { kind: ExtensionIdentityInviteWireKind.NotOffered },
  })
  expect(work?.message.eventLogRecords.map((each) => each.eventId)).toEqual([
    record.eventId,
  ])
})

test('a failed join is reported, not read as connected', async () => {
  const fixture = new SessionFixture(false)
  const result = await new PairingIdentityConnection(
    fixture.request(approval(invited)),
  ).connect(3)

  expect(result).toEqual({
    ok: false,
    reason: PairingIdentityConnectionFailure.JoinFailed,
  })
  expect(fixture.imported).toHaveLength(0)
})

test('a join the session refuses is reported with no other vault paired', async () => {
  const fixture = new SessionFixture(true)
  const refusing: IdentitySessionSend = (...request) => {
    const [message] = request
    fixture.sent.push(message)
    const refused: ExtensionSessionResponse = {
      ok: false,
      reason: 'GitHub authentication failed.',
    }
    return Promise.resolve(ok(refused))
  }
  const connectionRequest: PairingIdentityConnectionRequest = {
    ...fixture.request(approval(invited)),
    sendSessionMessage: refusing,
  }
  const result = await new PairingIdentityConnection(connectionRequest).connect(
    3,
  )

  expect(result).toEqual({
    ok: false,
    reason: PairingIdentityConnectionFailure.JoinFailed,
  })
  expect(fixture.sent).toHaveLength(1)
  expect(fixture.imported).toHaveLength(0)
})
