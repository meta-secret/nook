import { ok } from 'neverthrow'
import { beforeEach, describe, expect, test, vi } from 'vitest'

/** The explicit-lock mark lives in browser session storage, which the WASM
 * build cannot reach here. */
const markVaultSessionLocked = vi.hoisted(() => vi.fn())

vi.mock('$app-wasm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$app-wasm')>()),
  set_vault_session_locked: markVaultSessionLocked,
}))

import {
  ExternalDeviceIdentityAuthorizationMode,
  NookVaultManager,
  type CompanionIdentityStatus,
  type NookAdoptedExtensionIdentityHandoff,
} from '$app-wasm'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import {
  adoptExtensionIdentity,
  PairedExtensionIdentityUnlock,
  type PairedExtensionIdentitySource,
} from '$lib/app/extension-identity-adoption'
import { ExtensionConnectFollowKind } from '$web-shared/extension/extension-connect-progress'
import { ExtensionPairedVaultIdentityStatusMessageStatus as PairedStatus } from '$web-shared/extension/paired-vault-identity-status'
import {
  ExtensionConnectScope,
  ExtensionIdentityRequestSource,
  extensionConnectionBrowser,
  type ExtensionConnectRequest,
  type PairedExtensionIdentityDiscoveryResult,
} from '$lib/extension/connect'
import type { VaultState } from '$lib/vault.svelte'
import { VaultStateTestFixture } from '../vault-state-test-fixture'
import { PAIRED_EXTENSION_UNLOCK_TIMEOUT_MS } from '$lib/app/paired-extension-unlock-delivery'

const request: ExtensionConnectRequest = {
  source: ExtensionIdentityRequestSource.ExtensionConnect,
  follow: { kind: ExtensionConnectFollowKind.Unnamed },
  deviceId: 'device-1',
  devicePublicKey: 'age1device',
  deviceSigningPublicKey: 'signing-key',
  extensionRuntimeId: 'extension-123',
  deviceLabel: 'Nook Extension',
  nonce: 'nonce-1',
  scopes: [ExtensionConnectScope.VaultAccess],
}

const handoff = {
  requires_connect: vi.fn(() => false),
  mark_existing_vault_import: vi.fn((): void => {}),
  commit: vi.fn(),
  after_verified_connect: vi.fn(),
  rollback: vi.fn((): void => {}),
  free: vi.fn(),
  [Symbol.dispose]: vi.fn(),
} satisfies NookAdoptedExtensionIdentityHandoff

const pairedFor = {
  request_id: 'discovery',
  vault_store_id: 'store-qwe',
} as const
const extensionLocked: CompanionIdentityStatus = {
  status: 'locked',
  ...pairedFor,
}
const extensionUnavailable: CompanionIdentityStatus = {
  status: 'unavailable',
  ...pairedFor,
}

/** What the paired extension reports, one answer per discovery. */
function extensionReporting(
  ...answers: PairedExtensionIdentityDiscoveryResult[]
) {
  const discover =
    vi.fn<
      PairedExtensionIdentitySource['discoverAdmittedPairedExtensionIdentity']
    >()
  for (const answer of answers) discover.mockResolvedValueOnce(answer)
  const requestUnlock = vi.fn<
    PairedExtensionIdentitySource['requestPairedExtensionUnlock']
  >(async () => true)
  const source: PairedExtensionIdentitySource = {
    discoverAdmittedPairedExtensionIdentity: discover,
    requestPairedExtensionUnlock: requestUnlock,
  }
  return { source, discover, requestUnlock }
}

const unlocked: PairedExtensionIdentityDiscoveryResult = ok({
  discovery: { status: PairedStatus.Unlocked, request },
  canonicalStatus: extensionLocked,
})
const locked: PairedExtensionIdentityDiscoveryResult = ok({
  discovery: { status: PairedStatus.Locked },
  canonicalStatus: extensionLocked,
})
const unavailable: PairedExtensionIdentityDiscoveryResult = ok({
  discovery: { status: PairedStatus.Unavailable },
  canonicalStatus: extensionUnavailable,
})

function vaultAdopting(): {
  vault: VaultState
  authorize: ReturnType<typeof vi.fn>
} {
  const vault = VaultStateTestFixture.create()
  vi.spyOn(vault, 't').mockImplementation((key) =>
    typeof key === 'string' ? key : key.key,
  )
  const authorize = vi.fn(async () => true)
  vault.authorizeWithExternalDeviceIdentity = authorize
  return { vault, authorize }
}

describe('extension identity adoption', () => {
  test('hands over the extension request and opens no vault itself', async () => {
    const vault = VaultStateTestFixture.create()
    const manager = new NookVaultManager()
    const adoptHandoff = vi
      .spyOn(extensionConnectionBrowser, 'adoptExtensionIdentity')
      .mockResolvedValue(ok(handoff))
    const authorize = vi
      .spyOn(vault, 'authorizeWithExternalDeviceIdentity')
      .mockImplementation(async ({ adopt }) => {
        await adopt(manager)
        return true
      })
    const loadDb = vi.spyOn(vault, 'loadDb')

    const adopted = await adoptExtensionIdentity({
      vault,
      request,
      mode: ExternalDeviceIdentityAuthorizationMode.ContinueInitialization,
    })

    expect(adopted).toBe(true)
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: ExternalDeviceIdentityAuthorizationMode.ContinueInitialization,
      }),
    )
    expect(adoptHandoff).toHaveBeenCalledWith({ manager, request })
    expect(loadDb).not.toHaveBeenCalled()
  })
})

describe('unlocking an identity whose key the paired extension holds', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('adopts the identity alone from a fresh request and keeps vaults closed', async () => {
    const { vault, authorize } = vaultAdopting()
    const { source, discover } = extensionReporting(unlocked)

    const done = await new PairedExtensionIdentityUnlock({
      vault,
      storeId: 'store-qwe',
      source,
    }).unlock()

    expect(done).toBe(true)
    expect(discover).toHaveBeenCalledWith('store-qwe')
    expect(markVaultSessionLocked).toHaveBeenCalledWith(true)
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: ExternalDeviceIdentityAuthorizationMode.IdentityOnly,
      }),
    )
    expect(vault.errorMsg).toBe('')
  })

  test('asks the extension to unlock within the click, before any wait', () => {
    const { vault } = vaultAdopting()
    const { source, discover, requestUnlock } = extensionReporting(unlocked)

    // Not awaited: what matters is what happened before the first wait.
    void new PairedExtensionIdentityUnlock({
      vault,
      storeId: 'store-qwe',
      source,
    }).unlock()

    expect(requestUnlock).toHaveBeenCalledExactlyOnceWith('store-qwe')
    const [requestedAt] = requestUnlock.mock.invocationCallOrder
    const [discoveredAt] = discover.mock.invocationCallOrder
    expect(requestedAt).toBeLessThan(Number(discoveredAt))
  })

  test('asks a locked extension to unlock once, then adopts once it has', async () => {
    const { vault, authorize } = vaultAdopting()
    const { source, requestUnlock } = extensionReporting(
      locked,
      locked,
      unlocked,
    )

    const done = await new PairedExtensionIdentityUnlock({
      vault,
      storeId: 'store-qwe',
      source,
    }).unlock()

    expect(done).toBe(true)
    expect(requestUnlock).toHaveBeenCalledOnce()
    expect(authorize).toHaveBeenCalledOnce()
  })

  test('says why when the extension cannot serve this vault', async () => {
    const { vault, authorize } = vaultAdopting()
    const { source } = extensionReporting(unavailable)

    const done = await new PairedExtensionIdentityUnlock({
      vault,
      storeId: 'store-qwe',
      source,
    }).unlock()

    expect(done).toBe(false)
    expect(authorize).not.toHaveBeenCalled()
    expect(vault.errorMsg).toBe(I18N_KEYS.ExtensionConnectIdentityHandoffFailed)
  })

  test('says the extension is still locked when it is not unlocked in time', async () => {
    // Each look at the clock moves it ten seconds on, so the page's wait
    // runs out after a few discoveries.
    let clock = 0
    const now = vi
      .spyOn(Date, 'now')
      .mockImplementation(() => (clock += 10_000))
    try {
      const { vault, authorize } = vaultAdopting()
      const { source, discover } = extensionReporting()
      discover.mockResolvedValue(locked)

      const done = await new PairedExtensionIdentityUnlock({
        vault,
        storeId: 'store-qwe',
        source,
      }).unlock()

      expect(done).toBe(false)
      expect(discover.mock.calls.length).toBeLessThanOrEqual(
        PAIRED_EXTENSION_UNLOCK_TIMEOUT_MS / 10_000,
      )
      expect(authorize).not.toHaveBeenCalled()
      expect(vault.errorMsg).toBe(
        I18N_KEYS.ExtensionConnectPairedUnlockTimedOut,
      )
    } finally {
      now.mockRestore()
    }
  })

  test('says why when the unlock request cannot reach the extension', async () => {
    const { vault, authorize } = vaultAdopting()
    const { source, requestUnlock } = extensionReporting(locked)
    requestUnlock.mockResolvedValue(false)

    const done = await new PairedExtensionIdentityUnlock({
      vault,
      storeId: 'store-qwe',
      source,
    }).unlock()

    expect(done).toBe(false)
    expect(authorize).not.toHaveBeenCalled()
    expect(vault.errorMsg).toBe(I18N_KEYS.ExtensionConnectMessagingUnavailable)
  })
})
