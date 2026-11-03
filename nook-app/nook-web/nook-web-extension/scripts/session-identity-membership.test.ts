import { beforeAll, describe, expect, test } from 'bun:test'
import initNookWasm, {
  configure_vault_application,
  VaultApplication,
  type AuthProvidersSnapshot,
  type IdentityControlStanding,
  type IdentityControlSnapshot,
  type IdentityVaultPairingPlan,
  type NookPairedVaults,
  type NookStorageConnection,
  type StorageProvider,
} from '../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import { ExtensionSessionMessageType } from '../src/lib/extension-session-message-type'
import { MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE } from '../src/offscreen/session-request-adapter'
import {
  beginExtensionIdentityConnection,
  refreshExtensionIdentityVaults,
  type ExtensionMembershipManager,
  type RefreshExtensionIdentityVaultsRequest,
} from '../src/offscreen/session-identity-membership'
import { ProviderRowFixture } from './provider-row-fixture'
import { localS3Credentials, LocalS3Identity } from './local-s3'

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

function githubProvider(): StorageProvider {
  return ProviderRowFixture.github(ProviderRowFixture.PLAINTEXT)
}

const S3_SECRET = localS3Credentials(LocalS3Identity.DeviceA).secretAccessKey

/** The offscreen session's WASM manager, as far as membership uses it. */
class MembershipManager {
  readonly synced: NookStorageConnection[] = []
  readonly paired: NookPairedVaults[] = []
  readonly started: string[] = []
  constructor(
    private readonly standing: IdentityControlStanding,
    private readonly mounts: StorageProvider[],
    private readonly syncFails: boolean,
  ) {}

  private snapshot(providers: StorageProvider[]): AuthProvidersSnapshot {
    return { providers, activeVaultStoreId: { state: 'unselected' } }
  }

  manager(): ExtensionMembershipManager {
    const manager: ExtensionMembershipManager = {
      load_auth_providers_snapshot: () =>
        Promise.resolve(this.snapshot(this.mounts)),
      identity_control_snapshot: () => {
        const identity: IdentityControlSnapshot = {
          identityId: 'identity-family',
          identityLabel: 'Family',
          standing: this.standing,
          members: [],
          devices: [],
          deviceCount: 0,
          joinRequests: [],
          vaults: [],
          mounts: [],
        }
        return Promise.resolve(identity)
      },
      identity_replication_providers: () =>
        Promise.resolve(this.snapshot(this.mounts)),
      sync_identity_log_with_provider: (connection) => {
        this.synced.push(connection)
        if (this.syncFails)
          return Promise.reject(new Error('GitHub authentication failed.'))
        return Promise.resolve({
          pulledNewEvents: true,
          pushedNewEvents: false,
        })
      },
      identity_vault_pairing_plan: (_providers, paired) => {
        this.paired.push(paired)
        const plan: IdentityVaultPairingPlan = {
          identityId: 'identity-family',
          identityLabel: 'Family',
          standing: this.standing,
          toPair: this.standing === 'member' ? ['store_later'] : [],
          awaitingGrant: this.standing === 'member' ? ['store_unshared'] : [],
        }
        return Promise.resolve(plan)
      },
      begin_identity_connection: (label) => {
        this.started.push(label)
        return Promise.resolve('new-key-staged')
      },
      cancel_local_identity_creation: () => {},
      activate_local_identity_for_app_id: () => Promise.resolve(''),
    }
    return manager
  }
}

function refresh(
  manager: MembershipManager,
): ReturnType<typeof refreshExtensionIdentityVaults> {
  const request: RefreshExtensionIdentityVaultsRequest = {
    manager: manager.manager(),
    message: {
      type: ExtensionSessionMessageType.RefreshIdentityVaults,
      payload: {
        pairedVaultStoreIds: ['store_approved'],
        queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
      },
    },
  }
  return refreshExtensionIdentityVaults(request)
}

describe('refreshing the unlocked identity in the offscreen session', () => {
  test('syncs the identity log through each provider, then plans pairing', async () => {
    const manager = new MembershipManager('member', [githubProvider()], false)

    const refreshed = await refresh(manager)

    expect(manager.synced).toEqual([
      {
        mode: 'github',
        token: ProviderRowFixture.PLAINTEXT,
        repo: 'nook',
      },
    ])
    expect(manager.paired).toEqual([{ storeIds: ['store_approved'] }])
    expect(refreshed._unsafeUnwrap()).toEqual({
      ok: true,
      standing: 'member',
      identityLabel: 'Family',
      toPair: ['store_later'],
      awaitingGrant: ['store_unshared'],
      mountProviderIds: ['github'],
    })
  })

  test('syncs the identity log through an S3 mount and opens vaults through it', async () => {
    const manager = new MembershipManager(
      'member',
      [ProviderRowFixture.s3(S3_SECRET)],
      false,
    )

    const refreshed = await refresh(manager)

    expect(manager.synced).toEqual([
      {
        mode: 's3',
        // A storage request signs with the row's own key and carries no spare.
        connection: {
          ...ProviderRowFixture.s3Connection(S3_SECRET),
          spareKeys: [],
        },
      },
    ])
    expect(refreshed._unsafeUnwrap()).toMatchObject({
      mountProviderIds: ['s3'],
    })
  })

  test('syncs through a local folder but opens no vault through it', async () => {
    const manager = new MembershipManager(
      'member',
      [ProviderRowFixture.localFolder(), githubProvider()],
      false,
    )

    const refreshed = await refresh(manager)

    expect(manager.synced).toEqual([
      { mode: 'local' },
      { mode: 'github', token: ProviderRowFixture.PLAINTEXT, repo: 'nook' },
    ])
    expect(refreshed._unsafeUnwrap()).toMatchObject({
      mountProviderIds: ['github'],
    })
  })

  test('an extension that never joined an identity syncs nothing', async () => {
    const manager = new MembershipManager(
      'notReplicated',
      [githubProvider()],
      false,
    )

    const refreshed = await refresh(manager)

    expect(manager.synced).toHaveLength(0)
    expect(refreshed._unsafeUnwrap()).toMatchObject({
      toPair: [],
      mountProviderIds: [],
    })
  })

  test('a provider that fails ends the refresh with the failure', async () => {
    const manager = new MembershipManager('member', [githubProvider()], true)

    const refreshed = await refresh(manager)

    expect(refreshed.isErr()).toBe(true)
    expect(manager.paired).toHaveLength(0)
  })

  test('vaults to pair without a provider to open them fail visibly', async () => {
    const manager = new MembershipManager('member', [], false)

    const refreshed = await refresh(manager)

    expect(refreshed.isErr()).toBe(true)
  })
})

test('connecting another identity reports how Rust starts it', async () => {
  const manager = new MembershipManager('member', [], false)
  const request: Parameters<typeof beginExtensionIdentityConnection>[0] = {
    manager: manager.manager(),
    message: {
      type: ExtensionSessionMessageType.BeginIdentityConnection,
      payload: {
        label: 'Nook Extension',
        queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
      },
    },
  }

  const started = await beginExtensionIdentityConnection(request)

  expect(manager.started).toEqual(['Nook Extension'])
  expect(started._unsafeUnwrap()).toEqual({
    ok: true,
    start: 'new-key-staged',
  })
})
