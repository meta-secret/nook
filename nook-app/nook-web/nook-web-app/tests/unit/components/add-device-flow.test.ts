import { render, screen } from '@testing-library/svelte'
import type { ComponentProps } from 'svelte'
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { ok } from 'neverthrow'
import initNookWasm, {
  DeviceProtectionStatus,
  type IdentityControlSnapshot,
} from '$app-wasm'
import {
  providerPersistenceDefaults,
  storedGithubPat,
  storedGithubRepository,
  type StorageProvider,
} from '$lib/auth/providers'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import {
  IdentityActionOutcome,
  IdentityControlViewKind,
  type IdentityControlView,
} from '$lib/vault/identity-control.svelte'
import { VaultStateTestFixture } from '../vault-state-test-fixture'
import AddDeviceFlow from '../../../../nook-web-shared/src/vault-app/lib/components/add-device/AddDeviceFlow.svelte'

beforeAll(async () => {
  await initNookWasm()
})

afterEach(() => {
  vi.restoreAllMocks()
})

const IDENTITY = 'Personal'

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

function snapshot(
  standing: IdentityControlSnapshot['standing'],
): IdentityControlSnapshot {
  return {
    identityId: 'idn_test',
    identityLabel: IDENTITY,
    standing,
    members: [],
    joinRequests: [],
    vaults: [],
    mounts: [],
  }
}

function renderFlow(standing: IdentityControlSnapshot['standing']) {
  const vault = VaultStateTestFixture.create()
  const ready: IdentityControlView = {
    kind: IdentityControlViewKind.Ready,
    snapshot: snapshot(standing),
  }
  vault.identityControl.view = ready
  vault.identityControl.mounts = [cloudMount()]
  vault.deviceProtectionLockedStatus = DeviceProtectionStatus.Passkey
  vault.openActiveVault('store_vault')
  vi.spyOn(vault.identityControl, 'followOpenVault').mockResolvedValue(
    ok(IdentityActionOutcome.Completed),
  )
  const props = {
    vault,
    identityName: IDENTITY,
    onBack: vi.fn(),
    onOpenSync: vi.fn(),
    onManageAccounts: vi.fn(),
  } satisfies ComponentProps<typeof AddDeviceFlow>
  render(AddDeviceFlow, props)
  return vault
}

describe('add a device', () => {
  test('says this browser has not joined instead of showing nothing', () => {
    const vault = renderFlow('pendingJoin')

    expect(screen.getByTestId('add-device-stage').dataset.stage).toBe(
      'not-member',
    )
    expect(screen.getByTestId('add-device-not-member').textContent).toContain(
      vault.t({
        key: I18N_KEYS.AddDeviceNotMemberBrowser,
        replacements: { identity: IDENTITY },
      }),
    )
    expect(screen.queryAllByTestId('onboard-device-submit')).toHaveLength(0)
  })

  test('shows a failure on the page', () => {
    const vault = VaultStateTestFixture.create()
    vault.errorMsg = 'Could not load the identity.'
    vi.spyOn(vault.identityControl, 'followOpenVault').mockResolvedValue(
      ok(IdentityActionOutcome.Completed),
    )
    render(AddDeviceFlow, {
      vault,
      identityName: IDENTITY,
      onBack: vi.fn(),
      onOpenSync: vi.fn(),
      onManageAccounts: vi.fn(),
    })

    expect(screen.getByTestId('add-device-error').textContent).toContain(
      'Could not load the identity.',
    )
  })
})
