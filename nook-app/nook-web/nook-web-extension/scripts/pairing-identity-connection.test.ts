import { beforeAll, describe, expect, test } from 'bun:test'
import { ok } from 'neverthrow'
import initNookWasm, {
  configure_vault_application,
  VaultApplication,
} from '../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import { companionWasmReady } from '../../nook-web-shared/src/extension/companion-ready'
import type { ExtensionEventLogRecord } from '../../nook-web-shared/src/extension/lifecycle-runtime-messages'
import type { ExtensionKeyringApproval } from '../../nook-web-shared/src/extension/runtime-messages'
import type { ExtensionKeyringVault } from '../../nook-web-shared/src/extension/keyring-grant-wire'
import { ExtensionConnectScope } from '../../nook-web-shared/src/extension/extension-connect-scope'
import type { StoredExtensionKeyring } from '../src/background/pairing-grants'
import {
  PairingIdentityConnection,
  PairingIdentityConnectionFailure,
  type IdentitySessionSend,
  type PairedVaultImport,
  type PairedVaultImportRequest,
  type PairingIdentityConnectionRequest,
  type PairingIdentityImportResult,
} from '../src/background/service-worker/pairing-identity-connection'
import { IdentityVaultPairingFailure } from '../src/background/service-worker/identity-vault-pairing'
import type { ExtensionSessionResponse } from '../src/offscreen/session'
import { ExtensionSessionMessageType } from '../src/lib/extension-session-message-type'
import { MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE } from '../src/offscreen/session-request-adapter'
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

const PERSONAL_STORE = 'store_aaaaaaaaaaa'
const WORK_STORE = 'store_bbbbbbbbbbb'

const record: ExtensionEventLogRecord = {
  eventId: 'sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo',
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

/** The sealed provider copies, as opaque to the TypeScript side as Rust
 * keeps them. */
const providerShares: ExtensionKeyringApproval['providers'] = {
  apps: [{ appId: 'device-extension', providers: [] }],
}

function approval(vaults: ExtensionKeyringVault[]): ExtensionKeyringApproval {
  const approved: ExtensionKeyringApproval = {
    deviceId: 'device-extension',
    devicePublicKey: 'age1extension',
    deviceSigningPublicKey: 'extension-signing',
    deviceLabel: 'Nook Extension - Chrome',
    approvedAt: 1_792_000_000_000,
    scopes: [
      ExtensionConnectScope.VaultAccess,
      ExtensionConnectScope.SyncProviderCredentials,
    ],
    identityId: 'identity-personal',
    identityLabel: 'Personal',
    identityEvents: ['identity-event-1'],
    vaults,
    providers: providerShares,
  }
  return approved
}

const twoVaults: ExtensionKeyringVault[] = [
  { storeId: PERSONAL_STORE, eventLogRecords: [record] },
  { storeId: WORK_STORE, eventLogRecords: [record] },
]

/** The keyring record the extension keeps once it joined. */
function joinedKeyring(): StoredExtensionKeyring {
  const keyring: StoredExtensionKeyring = {
    identityId: 'identity-personal',
    identityLabel: 'Personal',
    deviceId: 'device-extension',
    devicePublicKey: 'age1extension',
    deviceSigningPublicKey: 'extension-signing',
    deviceLabel: 'Nook Extension - Chrome',
    approvedAt: 1_792_000_000_000,
    scopes: [
      ExtensionConnectScope.VaultAccess,
      ExtensionConnectScope.SyncProviderCredentials,
    ],
  }
  return keyring
}

enum JoinAnswer {
  Joined = 'joined',
  Undelivered = 'undelivered',
  Refused = 'refused',
}

type ConnectionFixtureOptions = {
  /** How the session answers the join. */
  readonly join: JoinAnswer
  /** The vaults the joined keyring's log lists. */
  readonly listedStoreIds: readonly string[]
  readonly providersTaken: boolean
  readonly keyringRecorded: boolean
  /** A vault the session cannot open. */
  readonly unopenedStoreId: string
}

const allSucceed: ConnectionFixtureOptions = {
  join: JoinAnswer.Joined,
  listedStoreIds: [PERSONAL_STORE, WORK_STORE],
  providersTaken: true,
  keyringRecorded: true,
  unopenedStoreId: '',
}

/** The offscreen session, the provider hand-off, the keyring store and the
 * vault import, as the connection drives them, in the order it does. */
class ConnectionFixture {
  readonly steps: string[] = []
  readonly connected: unknown[] = []
  readonly takenShares: unknown[] = []
  readonly recorded: StoredExtensionKeyring[] = []
  readonly imported: PairedVaultImportRequest[] = []
  constructor(private readonly options: ConnectionFixtureOptions) {}

  readonly send: IdentitySessionSend = (...request) => {
    const [message] = request
    if (message.type === ExtensionSessionMessageType.JoinIdentity) {
      this.steps.push('join')
      expect(message.payload).toMatchObject({
        identityId: 'identity-personal',
        memberLabel: 'Nook Extension - Chrome',
        identityEvents: ['identity-event-1'],
      })
      switch (this.options.join) {
        case JoinAnswer.Undelivered: {
          const failure = new ExtensionSessionTransportFailure(
            ExtensionSessionTransportFailureKind.DeliveryFailed,
          )
          return Promise.resolve(failure.toResult<ExtensionSessionResponse>())
        }
        case JoinAnswer.Refused: {
          const refused: ExtensionSessionResponse = {
            ok: false,
            reason: 'GitHub authentication failed.',
          }
          return Promise.resolve(ok(refused))
        }
        case JoinAnswer.Joined:
          break
      }
      const joined: ExtensionSessionResponse = {
        ok: true,
        identityId: 'identity-personal',
        identityLabel: 'Personal',
        vaults: this.options.listedStoreIds.map((storeId) => ({ storeId })),
      }
      return Promise.resolve(ok(joined))
    }
    expect(message.type).toBe(ExtensionSessionMessageType.ConnectIdentityVault)
    if (!('payload' in message)) throw new Error('expected a vault to open')
    const { payload } = message
    const storeId =
      payload && typeof payload === 'object' && 'vaultStoreId' in payload
        ? payload.vaultStoreId
        : ''
    this.steps.push(`connect ${String(storeId)}`)
    this.connected.push(payload)
    if (storeId === this.options.unopenedStoreId) {
      const refused: ExtensionSessionResponse = { ok: false, reason: 'failed' }
      return Promise.resolve(ok(refused))
    }
    const opened: ExtensionSessionResponse = {
      ok: true,
      vaultName: storeId === WORK_STORE ? 'Work' : 'Personal vault',
      eventLogRecords: [record],
    }
    return Promise.resolve(ok(opened))
  }

  readonly importVault: PairedVaultImport = (request) => {
    this.steps.push(`import ${request.grant.vaultStoreId}`)
    this.imported.push(request)
    const imported: PairingIdentityImportResult = { ok: true, eventCount: 5 }
    return Promise.resolve(imported)
  }

  readonly takeKeyringProviders: PairingIdentityConnectionRequest['takeKeyringProviders'] =
    (shares) => {
      this.steps.push('take providers')
      this.takenShares.push(shares)
      if (!this.options.providersTaken)
        return Promise.reject(new Error('providers not sealed to this app'))
      return Promise.resolve(2)
    }

  readonly recordKeyring: PairingIdentityConnectionRequest['recordKeyring'] = (
    keyring,
  ) => {
    this.steps.push('record keyring')
    this.recorded.push(keyring)
    if (!this.options.keyringRecorded)
      return Promise.reject(new Error('storage unavailable'))
    return Promise.resolve()
  }

  connection(approved: ExtensionKeyringApproval): PairingIdentityConnection {
    const request: PairingIdentityConnectionRequest = {
      approval: approved,
      importVault: this.importVault,
      sendSessionMessage: this.send,
      takeKeyringProviders: this.takeKeyringProviders,
      recordKeyring: this.recordKeyring,
    }
    return new PairingIdentityConnection(request)
  }
}

/** Join, then pair the vaults handed over, as the approval import does. */
async function connectAll(
  connection: PairingIdentityConnection,
): Promise<PairingIdentityImportResult> {
  const keyring = await connection.join()
  if (!keyring.ok) return keyring
  return connection.pairVaults(keyring.joined)
}

describe('connecting the extension to the keyring it was approved into', () => {
  test('a keyring with no vault is joined, its providers taken and its record kept', async () => {
    const fixture = new ConnectionFixture({ ...allSucceed, listedStoreIds: [] })
    const connection = fixture.connection(approval([]))

    const joined = await connection.join()

    expect(joined).toEqual({
      ok: true,
      joined: {
        storeIds: [],
        keyring: joinedKeyring(),
        syncProviderCount: 2,
      },
    })
    expect(fixture.takenShares).toEqual([providerShares])
    expect(fixture.recorded).toEqual([joinedKeyring()])
    if (!joined.ok) return
    // Connected with no vault to pair: nothing opens, nothing imports.
    expect(await connection.pairVaults(joined.joined)).toEqual({
      ok: true,
      eventCount: 0,
    })
    expect(fixture.steps).toEqual(['join', 'take providers', 'record keyring'])
    expect(fixture.imported).toHaveLength(0)
  })

  test('each vault handed over pairs from its records under the keyring app', async () => {
    const fixture = new ConnectionFixture(allSucceed)

    const result = await connectAll(fixture.connection(approval(twoVaults)))

    expect(result).toEqual({ ok: true, eventCount: 10 })
    // The keyring is joined and kept before any vault opens.
    expect(fixture.steps).toEqual([
      'join',
      'take providers',
      'record keyring',
      `connect ${PERSONAL_STORE}`,
      `import ${PERSONAL_STORE}`,
      `connect ${WORK_STORE}`,
      `import ${WORK_STORE}`,
    ])
    expect(fixture.connected).toEqual([
      {
        vaultStoreId: PERSONAL_STORE,
        source: { kind: 'records', eventLogRecords: [record] },
        queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
      },
      {
        vaultStoreId: WORK_STORE,
        source: { kind: 'records', eventLogRecords: [record] },
        queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
      },
    ])
    const [, work] = fixture.imported
    expect(work?.grant).toEqual({
      vaultType: 'simple',
      deviceId: 'device-extension',
      devicePublicKey: 'age1extension',
      deviceSigningPublicKey: 'extension-signing',
      deviceLabel: 'Nook Extension - Chrome',
      vaultStoreId: WORK_STORE,
      vaultName: 'Work',
      identityLabel: 'Personal',
      approvedAt: 1_792_000_000_000,
      scopes: [
        ExtensionConnectScope.VaultAccess,
        ExtensionConnectScope.SyncProviderCredentials,
      ],
      syncProviderCount: 2,
    })
    expect(work?.eventLogRecords.map((each) => each.eventId)).toEqual([
      record.eventId,
    ])
  })

  test('a vault the joined keyring no longer lists is not paired', async () => {
    const fixture = new ConnectionFixture({
      ...allSucceed,
      listedStoreIds: [WORK_STORE],
    })

    const result = await connectAll(fixture.connection(approval(twoVaults)))

    expect(result).toEqual({ ok: true, eventCount: 5 })
    expect(fixture.imported.map((each) => each.grant.vaultStoreId)).toEqual([
      WORK_STORE,
    ])
  })

  test('a vault that does not open ends the pairing with that failure', async () => {
    const fixture = new ConnectionFixture({
      ...allSucceed,
      unopenedStoreId: PERSONAL_STORE,
    })

    const result = await connectAll(fixture.connection(approval(twoVaults)))

    expect(result).toEqual({
      ok: false,
      reason: IdentityVaultPairingFailure.VaultConnectFailed,
    })
    // The keyring stays joined; the vault after the failed one is not tried.
    expect(fixture.recorded).toEqual([joinedKeyring()])
    expect(fixture.steps.at(-1)).toBe(`connect ${PERSONAL_STORE}`)
    expect(fixture.imported).toHaveLength(0)
  })
})

type JoinStepFailure = {
  readonly name: string
  readonly options: ConnectionFixtureOptions
  readonly reason: PairingIdentityConnectionFailure
  /** The steps that ran, the failed one last. */
  readonly steps: string[]
}

describe('a join step that fails stores nothing further', () => {
  const joinStepFailures: JoinStepFailure[] = [
    {
      name: 'a join the session cannot receive',
      options: { ...allSucceed, join: JoinAnswer.Undelivered },
      reason: PairingIdentityConnectionFailure.JoinFailed,
      steps: ['join'],
    },
    {
      name: 'a join the session refuses',
      options: { ...allSucceed, join: JoinAnswer.Refused },
      reason: PairingIdentityConnectionFailure.JoinFailed,
      steps: ['join'],
    },
    {
      name: 'providers Rust does not take',
      options: { ...allSucceed, providersTaken: false },
      reason: PairingIdentityConnectionFailure.ProvidersNotTaken,
      steps: ['join', 'take providers'],
    },
    {
      name: 'a keyring record that is not kept',
      options: { ...allSucceed, keyringRecorded: false },
      reason: PairingIdentityConnectionFailure.KeyringNotRecorded,
      steps: ['join', 'take providers', 'record keyring'],
    },
  ]
  test.each(joinStepFailures)(
    '$name is reported before any vault pairs',
    async ({ options, reason, steps }) => {
      const fixture = new ConnectionFixture(options)

      const result = await connectAll(fixture.connection(approval(twoVaults)))

      expect(result).toEqual({ ok: false, reason })
      expect(fixture.steps).toEqual(steps)
      expect(fixture.connected).toHaveLength(0)
      expect(fixture.imported).toHaveLength(0)
    },
  )
})
