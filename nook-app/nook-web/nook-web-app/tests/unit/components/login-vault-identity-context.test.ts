import { describe, expect, test } from 'vitest'
import {
  DeviceAccessProtectionKind,
  NookIdentityLocalAccessKind,
} from '$app-wasm'
import { DashboardTextKind } from '../../../../nook-web-shared/src/vault-app/lib/components/devices-access-dashboard-state'
import type { IdentityDirectoryEntry } from '../../../../nook-web-shared/src/vault-app/lib/components/devices-access/identity-directory-view'
import {
  buildLoginVaultIdentityContext,
  LoginVaultIdentityContextKind,
} from '../../../../nook-web-shared/src/vault-app/lib/components/login/login-vault-identity-context'

function identity({
  identityId,
  label,
  localAccess,
  storeIds,
}: {
  identityId: string
  label: string
  localAccess: NookIdentityLocalAccessKind
  storeIds: readonly string[]
}): IdentityDirectoryEntry {
  return {
    identityId,
    label,
    localAccess,
    members: [
      {
        appId: `${identityId}-app`,
        label: { kind: DashboardTextKind.Unknown },
        currentBrowser:
          localAccess === NookIdentityLocalAccessKind.CurrentBrowser,
        localProtection: DeviceAccessProtectionKind.Missing,
      },
    ],
    vaults: storeIds.map((storeId) => ({
      storeId,
      label: `Vault ${storeId}`,
      verified: true,
      verifiedAt: { kind: DashboardTextKind.Unknown },
      lastLocalUpdateAt: { kind: DashboardTextKind.Unknown },
    })),
  }
}

const personal = identity({
  identityId: 'identity-personal',
  label: 'Personal',
  localAccess: NookIdentityLocalAccessKind.CurrentBrowser,
  storeIds: ['store-personal', 'store-shared'],
})

const work = identity({
  identityId: 'identity-work',
  label: 'Work',
  localAccess: NookIdentityLocalAccessKind.ThisBrowser,
  storeIds: ['store-work', 'store-shared'],
})

const travel = identity({
  identityId: 'identity-travel',
  label: 'Travel',
  localAccess: NookIdentityLocalAccessKind.OtherInstallation,
  storeIds: ['store-travel'],
})

describe('login vault identity context', () => {
  test('filters identities by the selected vault store id', () => {
    const context = buildLoginVaultIdentityContext({
      identities: [personal, work, travel],
      storeId: 'store-shared',
    })

    expect(context.kind).toBe(LoginVaultIdentityContextKind.LinkedWithCurrent)
    if (context.kind !== LoginVaultIdentityContextKind.LinkedWithCurrent) {
      throw new Error('expected a current-browser identity')
    }
    expect(context.identities.map(({ label }) => label)).toEqual([
      'Personal',
      'Work',
    ])
  })

  test('identifies the linked current-browser identity', () => {
    const context = buildLoginVaultIdentityContext({
      identities: [work, personal],
      storeId: 'store-personal',
    })

    expect(context).toMatchObject({
      kind: LoginVaultIdentityContextKind.LinkedWithCurrent,
      currentIdentity: { label: 'Personal' },
    })
  })

  test('keeps linked identities visible when the current browser does not match', () => {
    const context = buildLoginVaultIdentityContext({
      identities: [personal, work, travel],
      storeId: 'store-work',
    })

    expect(context).toMatchObject({
      kind: LoginVaultIdentityContextKind.LinkedWithoutCurrent,
      identities: [{ label: 'Work' }],
    })
  })

  test('reports an empty context when no identity links the selected vault', () => {
    const context = buildLoginVaultIdentityContext({
      identities: [personal, work, travel],
      storeId: 'store-unknown',
    })

    expect(context).toEqual({ kind: LoginVaultIdentityContextKind.Empty })
  })
})
