import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { err, ok } from 'neverthrow'
import initNookWasm, {
  VaultIdentityKeySource,
  type IdentityControlSnapshot,
} from '$app-wasm'
import {
  providerPersistenceDefaults,
  storedGithubPat,
  storedGithubRepository,
  type StorageProvider,
} from '$lib/auth/providers'
import {
  ExtensionConnectScope,
  ExtensionIdentityRequestSource,
  PairedExtensionDiscoveryFailure,
  PairedExtensionDiscoveryFailureKind,
  type ExtensionConnectRequest,
} from '$lib/extension/connect'
import { ExtensionPairingDeliveryKind } from '$lib/extension/extension-pairing-delivery'
import { ExtensionConnectFollowKind } from '$web-shared/extension/extension-connect-progress'
import { ExtensionPairedVaultIdentityStatusMessageStatus as PairedStatus } from '$web-shared/extension/paired-vault-identity-status'
import {
  IdentityControlViewKind,
  type IdentityControlView,
} from '$lib/vault/identity-control.svelte'
import {
  PairedExtensionIdentityJoin,
  PairedExtensionIdentityJoinOutcome,
  type PairedExtensionApprover,
  type PairedExtensionDiscover,
} from '$lib/vault/paired-extension-identity-join'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import { VaultStateTestFixture } from '../vault-state-test-fixture'

beforeAll(async () => {
  await initNookWasm()
})

afterEach(() => {
  vi.restoreAllMocks()
})

const STORE_ID = 'store_vault'
const PAGE_APP = 'app_page'
const EXTENSION_APP = 'app_extension'

type Scenario = {
  readonly keySource?: VaultIdentityKeySource
  readonly members?: readonly string[]
  readonly roster?: readonly string[]
  readonly cloud?: boolean
  readonly scopes?: ExtensionConnectScope[]
  readonly discover?: PairedExtensionDiscover
}

function cloudMount(): StorageProvider {
  return {
    ...providerPersistenceDefaults(),
    id: 'github-1',
    type: 'github',
    label: 'GitHub',
    githubRepo: storedGithubRepository('nook-vault'),
    githubPat: storedGithubPat('github_pat_test'),
    syncCheckpoint: { state: 'neverSynced' },
    createdAt: '2026-10-24T00:00:00.000Z',
  }
}

function extensionRequest(
  scopes: ExtensionConnectScope[],
): ExtensionConnectRequest {
  return {
    source: ExtensionIdentityRequestSource.ExtensionConnect,
    follow: { kind: ExtensionConnectFollowKind.Unnamed },
    deviceId: EXTENSION_APP,
    devicePublicKey: 'age1extension',
    deviceSigningPublicKey: 'signing-key',
    extensionRuntimeId: 'extension-123',
    deviceLabel: 'Nook Extension',
    nonce: 'nonce-1',
    scopes,
  }
}

function joinFor(scenario: Scenario) {
  const vault = VaultStateTestFixture.create()
  vault.identityKeySource =
    scenario.keySource ?? VaultIdentityKeySource.ThisBrowser
  vault.openActiveVault(STORE_ID)
  const snapshot: IdentityControlSnapshot = {
    identityId: 'idn_test',
    identityLabel: 'Personal',
    standing: 'member',
    members: (scenario.members ?? [PAGE_APP]).map((appId) => ({
      appId,
      label: '',
      isCurrentInstallation: appId === PAGE_APP,
    })),
    vaults: [],
    mounts: [],
  }
  const ready: IdentityControlView = {
    kind: IdentityControlViewKind.Ready,
    snapshot,
  }
  vault.identityControl.view = ready
  vault.identityControl.mounts = scenario.cloud === false ? [] : [cloudMount()]
  const scopes = scenario.scopes ?? [
    ExtensionConnectScope.SyncProviderCredentials,
  ]
  const discover = vi.fn<PairedExtensionDiscover>(
    scenario.discover ??
      (async () =>
        ok({
          status: PairedStatus.Unlocked,
          request: extensionRequest(scopes),
        })),
  )
  const approve = vi.fn<PairedExtensionApprover>(async () =>
    ok(ExtensionPairingDeliveryKind.Delivered),
  )
  const join = new PairedExtensionIdentityJoin({
    vault,
    discover,
    vaultRoster: () => scenario.roster ?? [PAGE_APP, EXTENSION_APP],
    approve,
  })
  return { join, discover, approve }
}

describe('a paired extension that joined only a vault', () => {
  test('is invited into the identity once it has a cloud copy', async () => {
    const { join, discover, approve } = joinFor({})

    const joined = await join.run()

    expect(joined._unsafeUnwrap()).toBe(
      PairedExtensionIdentityJoinOutcome.Invited,
    )
    expect(discover).toHaveBeenCalledWith(STORE_ID)
    expect(approve).toHaveBeenCalledOnce()
    expect(approve.mock.calls[0]?.[0].deviceId).toBe(EXTENSION_APP)
  })

  test("is not invited while the page runs on the extension's own key", async () => {
    const { join, discover, approve } = joinFor({
      keySource: VaultIdentityKeySource.PairedCompanion,
    })

    expect((await join.run())._unsafeUnwrap()).toBe(
      PairedExtensionIdentityJoinOutcome.Unchanged,
    )
    expect(discover).not.toHaveBeenCalled()
    expect(approve).not.toHaveBeenCalled()
  })

  test('waits for a cloud copy', async () => {
    const { join, discover, approve } = joinFor({ cloud: false })

    expect((await join.run())._unsafeUnwrap()).toBe(
      PairedExtensionIdentityJoinOutcome.Unchanged,
    )
    expect(discover).not.toHaveBeenCalled()
    expect(approve).not.toHaveBeenCalled()
  })

  test('is left alone once it is a member', async () => {
    const { join, approve } = joinFor({ members: [PAGE_APP, EXTENSION_APP] })

    expect((await join.run())._unsafeUnwrap()).toBe(
      PairedExtensionIdentityJoinOutcome.Unchanged,
    )
    expect(approve).not.toHaveBeenCalled()
  })

  test('is never approved again once the vault removed it', async () => {
    const { join, approve } = joinFor({ roster: [PAGE_APP] })

    expect((await join.run())._unsafeUnwrap()).toBe(
      PairedExtensionIdentityJoinOutcome.Unchanged,
    )
    expect(approve).not.toHaveBeenCalled()
  })

  test('is not invited without the sync-provider scope its approval granted', async () => {
    const { join, approve } = joinFor({
      scopes: [ExtensionConnectScope.VaultAccess],
    })

    expect((await join.run())._unsafeUnwrap()).toBe(
      PairedExtensionIdentityJoinOutcome.Unchanged,
    )
    expect(approve).not.toHaveBeenCalled()
  })

  test('a locked extension is invited later', async () => {
    const { join, approve } = joinFor({
      discover: async () => ok({ status: PairedStatus.Locked }),
    })

    expect((await join.run())._unsafeUnwrap()).toBe(
      PairedExtensionIdentityJoinOutcome.Unchanged,
    )
    expect(approve).not.toHaveBeenCalled()
  })

  test('no extension installed is nothing to do', async () => {
    const { join, approve } = joinFor({
      discover: async () =>
        err(
          new PairedExtensionDiscoveryFailure(
            PairedExtensionDiscoveryFailureKind.NotInstalled,
          ),
        ),
    })

    expect((await join.run())._unsafeUnwrap()).toBe(
      PairedExtensionIdentityJoinOutcome.Unchanged,
    )
    expect(approve).not.toHaveBeenCalled()
  })

  test('a failed delivery is reported', async () => {
    const { join, approve } = joinFor({})
    approve.mockResolvedValue(err(I18N_KEYS.ExtensionConsentGrantRejected))

    expect((await join.run())._unsafeUnwrapErr()).toBe(
      I18N_KEYS.ExtensionConsentGrantRejected,
    )
  })
})
