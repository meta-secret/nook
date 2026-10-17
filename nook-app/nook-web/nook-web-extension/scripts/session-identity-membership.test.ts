import { beforeAll, describe, expect, test } from 'bun:test'
import initNookWasm, {
  configure_vault_application,
  VaultApplication,
  type AuthProvidersSnapshot,
  type IdentityControlStanding,
  type IdentityControlSnapshot,
  type IdentityVaultPairingPlan,
  type NookPairedVaults,
  type StorageProvider,
} from '../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import { GITHUB_PROVIDER_TYPE } from '../../nook-web-shared/src/vault-app/lib/auth/provider-types'
import { ExtensionSessionMessageType } from '../src/lib/extension-session-message-type'
import { MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE } from '../src/offscreen/session-request-adapter'
import {
  beginExtensionIdentityConnection,
  refreshExtensionIdentityVaults,
  type ExtensionMembershipManager,
  type RefreshExtensionIdentityVaultsRequest,
} from '../src/offscreen/session-identity-membership'

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

function githubProvider(id: string): StorageProvider {
  return {
    id,
    type: GITHUB_PROVIDER_TYPE,
    label: 'Family GitHub',
    githubPat: { state: 'token', value: 'github_pat_session_secret' },
    githubRepo: { state: 'repository', value: 'family/vaults' },
    oauthFile: { state: 'notApplicable' },
    localFolder: { state: 'notApplicable' },
    storeId: { state: 'unscoped' },
    createdAt: '2026-10-16T00:00:00Z',
    syncCheckpoint: { state: 'neverSynced' },
  }
}

type SyncedProvider = { mode: string; pat: string; repo: string }

/** The offscreen session's WASM manager, as far as membership uses it. */
class MembershipManager {
  readonly synced: SyncedProvider[] = []
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
          vaults: [],
          mounts: [],
        }
        return Promise.resolve(identity)
      },
      identity_replication_providers: () =>
        Promise.resolve(this.snapshot(this.mounts)),
      sync_identity_log_with_provider: (mode, pat, repo) => {
        this.synced.push({ mode, pat, repo })
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
    const manager = new MembershipManager(
      'member',
      [githubProvider('github-family')],
      false,
    )

    const refreshed = await refresh(manager)

    expect(manager.synced).toEqual([
      {
        mode: 'github',
        pat: 'github_pat_session_secret',
        repo: 'family/vaults',
      },
    ])
    expect(manager.paired).toEqual([{ storeIds: ['store_approved'] }])
    expect(refreshed._unsafeUnwrap()).toEqual({
      ok: true,
      standing: 'member',
      identityLabel: 'Family',
      toPair: ['store_later'],
      awaitingGrant: ['store_unshared'],
      mountProviderIds: ['github-family'],
    })
  })

  test('an extension that never joined an identity syncs nothing', async () => {
    const manager = new MembershipManager(
      'notReplicated',
      [githubProvider('github-family')],
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
    const manager = new MembershipManager(
      'member',
      [githubProvider('github-family')],
      true,
    )

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
