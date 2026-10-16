import { render } from '@testing-library/svelte'
import { flushSync, type ComponentProps } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { ok } from 'neverthrow'
import { NookVaultManager } from '$app-wasm'
import {
  IdentityControlViewKind,
  type IdentityControlView,
} from '$lib/vault/identity-control.svelte'
import { VaultStateTestFixture } from '../vault-state-test-fixture'
import IdentitiesHub from '../../../../nook-web-shared/src/vault-app/lib/components/identities/IdentitiesHub.svelte'

/** Longer than the directory loader's whole retry schedule. */
const RETRIES_SETTLED_MS = 10_000

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('identities hub', () => {
  test('reads the identity directory again when the identity log changes', async () => {
    const vault = VaultStateTestFixture.create()
    VaultStateTestFixture.runStorageImmediately(vault)
    const manager = new NookVaultManager()
    const reads = vi
      .spyOn(manager, 'identity_directory_snapshot_request')
      .mockImplementation(() => {
        throw new Error('directory read')
      })
    vi.spyOn(vault, 'admitManager').mockReturnValue(ok(manager))
    const props = {
      vault,
      onOpenVault: vi.fn(),
      onNewIdentity: vi.fn(),
      onUseIdentity: vi.fn(),
    } satisfies ComponentProps<typeof IdentitiesHub>
    vi.useFakeTimers()

    render(IdentitiesHub, props)
    // Let the first read and its retries finish.
    await vi.advanceTimersByTimeAsync(RETRIES_SETTLED_MS)
    const settled = reads.mock.calls.length
    expect(settled).toBeGreaterThan(0)

    // A vault deleted everywhere from a card, or a device approved, is a new
    // projection of the identity log while the hub stays on screen.
    const reprojected: IdentityControlView = {
      kind: IdentityControlViewKind.Loading,
    }
    vault.identityControl.view = reprojected
    flushSync()
    await vi.advanceTimersByTimeAsync(RETRIES_SETTLED_MS)

    expect(reads.mock.calls.length).toBeGreaterThan(settled)
  })
})
