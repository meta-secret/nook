import { describe, expect, test } from 'vitest'
import {
  DeviceAccessProtectionKind,
  NookIdentityLocalAccessKind,
} from '$app-wasm'
import {
  IdentityCardProjection,
  IdentityCardStatus,
  IdentityKeyKind,
  IdentityVaultRowState,
  type IdentityCardSource,
} from '../../../../nook-web-shared/src/vault-app/lib/components/identities/identity-card-model'
import type {
  IdentityDirectoryEntry,
  IdentityMemberView,
} from '../../../../nook-web-shared/src/vault-app/lib/components/devices-access/identity-directory-view'
import {
  UnknownDashboardText,
  type DashboardText,
} from '../../../../nook-web-shared/src/vault-app/lib/components/devices-access-dashboard-state'

const unknown: DashboardText = new UnknownDashboardText()

function member(
  appId: string,
  protection: DeviceAccessProtectionKind,
): IdentityMemberView {
  return {
    appId,
    label: unknown,
    currentBrowser: false,
    localProtection: DeviceAccessProtectionKind.Missing,
    protectionAssociation: protection,
    associatedPasskeyName: unknown,
    associatedPasskeyFingerprint: unknown,
  }
}

function vaultAccess(storeId: string, label: string) {
  return {
    storeId,
    label,
    verified: true,
    verifiedAt: unknown,
    lastLocalUpdateAt: unknown,
  }
}

const personal: IdentityDirectoryEntry = {
  identityId: 'id_3f2a9c0b71de4e58aa10',
  label: 'Personal',
  localAccess: NookIdentityLocalAccessKind.CurrentBrowser,
  members: [
    member('browser', DeviceAccessProtectionKind.PasskeyStandard),
    member('phone', DeviceAccessProtectionKind.PinOrPassphrase),
  ],
  vaults: [
    vaultAccess('store_a', 'Old label'),
    vaultAccess('store_gone', 'Gone'),
  ],
}

const work: IdentityDirectoryEntry = {
  identityId: 'id_work',
  label: 'Work',
  localAccess: NookIdentityLocalAccessKind.ThisBrowser,
  members: [member('laptop', DeviceAccessProtectionKind.PinOrPassphrase)],
  vaults: [vaultAccess('store_w', 'Acme')],
}

const elsewhere: IdentityDirectoryEntry = {
  identityId: 'id_far',
  label: 'Family',
  localAccess: NookIdentityLocalAccessKind.OtherInstallation,
  members: [],
  vaults: [],
}

function source(authenticated: boolean): IdentityCardSource {
  return {
    identities: [personal, work, elsewhere],
    localVaults: [
      { storeId: 'store_a', label: 'Personal vault' },
      { storeId: 'store_b', label: 'Family photos' },
    ],
    currentLogVaults: [],
    openStoreId: authenticated ? 'store_a' : '',
    authenticated,
    identityUnlocked: authenticated,
  }
}

describe('identity card projection', () => {
  test('reports each identity status for this browser session', () => {
    const cards = new IdentityCardProjection(source(true)).cards
    expect(cards.map((card) => card.status)).toEqual([
      IdentityCardStatus.Unlocked,
      IdentityCardStatus.Inactive,
      IdentityCardStatus.Elsewhere,
    ])
    const locked = new IdentityCardProjection(source(false)).cards
    expect(locked[0]?.status).toBe(IdentityCardStatus.Locked)
  })

  test('an unlocked identity stays unlocked with no vault open', () => {
    const identityOnly: IdentityCardSource = {
      ...source(false),
      identityUnlocked: true,
    }
    const [current] = new IdentityCardProjection(identityOnly).cards
    expect(current?.status).toBe(IdentityCardStatus.Unlocked)
    expect(
      current?.vaults.some((row) => row.state === IdentityVaultRowState.Open),
    ).toBe(false)
  })

  test('lists the current identity vaults with local labels and the open vault', () => {
    const [current] = new IdentityCardProjection(source(true)).cards
    expect(current?.vaults).toEqual([
      {
        storeId: 'store_a',
        label: 'Personal vault',
        state: IdentityVaultRowState.Open,
      },
      {
        storeId: 'store_gone',
        label: 'Gone',
        state: IdentityVaultRowState.Unavailable,
      },
      {
        storeId: 'store_b',
        label: 'Family photos',
        state: IdentityVaultRowState.Available,
      },
    ])
  })

  test('lists vaults the current identity log holds but this browser does not', () => {
    const withLog: IdentityCardSource = {
      ...source(true),
      currentLogVaults: ['store_a', 'store_away'],
    }
    const [current, workCard] = new IdentityCardProjection(withLog).cards
    expect(current?.vaults).toContainEqual({
      storeId: 'store_away',
      label: 'store_away',
      state: IdentityVaultRowState.Unavailable,
    })
    expect(
      current?.vaults.filter((row) => row.storeId === 'store_a'),
    ).toHaveLength(1)
    expect(workCard?.vaults.some((row) => row.storeId === 'store_away')).toBe(
      false,
    )
  })

  test('never offers another identity vault for opening here', () => {
    const cards = new IdentityCardProjection(source(true)).cards
    expect(cards[1]?.vaults).toEqual([
      {
        storeId: 'store_w',
        label: 'Acme',
        state: IdentityVaultRowState.Unavailable,
      },
    ])
  })

  test('summarises key kinds and counts', () => {
    const cards = new IdentityCardProjection(source(false)).cards
    expect(cards.map((card) => [card.keyKind, card.keyCount])).toEqual([
      [IdentityKeyKind.Mixed, 2],
      [IdentityKeyKind.Pin, 1],
      [IdentityKeyKind.None, 0],
    ])
  })

  test('derives a stable monogram, hue, and grouped fingerprint', () => {
    const first = new IdentityCardProjection(source(false)).cards[0]
    const again = new IdentityCardProjection(source(true)).cards[0]
    expect(first?.monogram).toBe('P')
    expect(first?.fingerprint).toEqual(['3F2A', '9C0B', '71DE', '4E58'])
    expect(first?.hue).toBe(again?.hue)
    expect(first?.hue).toBeGreaterThanOrEqual(0)
    expect(first?.hue).toBeLessThan(360)
  })

  test('puts the identity this browser uses first, keeping the rest in order', () => {
    const switched: IdentityCardSource = {
      ...source(false),
      identities: [work, elsewhere, personal],
    }
    const cards = new IdentityCardProjection(switched).cards
    expect(cards.map((card) => card.label)).toEqual([
      'Personal',
      'Work',
      'Family',
    ])
  })

  test('totals identities, keys, vaults, and unlocked identities', () => {
    expect(new IdentityCardProjection(source(true)).totals).toEqual({
      identities: 3,
      keys: 3,
      vaults: 4,
      unlocked: 1,
    })
  })
})

describe('IdentityCardProjection vault ownership', () => {
  test('lists every vault under exactly one identity', () => {
    const sharedClaim: IdentityDirectoryEntry = {
      ...work,
      vaults: [vaultAccess('store_w', 'Acme'), vaultAccess('store_a', 'A')],
    }
    const ownershipSource: IdentityCardSource = {
      identities: [sharedClaim, personal],
      localVaults: [
        { storeId: 'store_a', label: 'Personal vault' },
        { storeId: 'store_w', label: 'Acme' },
        { storeId: 'store_new', label: 'Fresh' },
      ],
      currentLogVaults: [],
      openStoreId: '',
      authenticated: false,
      identityUnlocked: false,
    }
    const cards = new IdentityCardProjection(ownershipSource).cards
    const rowsOf = (identityId: string) =>
      cards
        .filter((card) => card.identityId === identityId)
        .flatMap((card) => card.vaults.map((row) => row.storeId))

    expect(rowsOf(personal.identityId)).toEqual([
      'store_a',
      'store_gone',
      'store_new',
    ])
    expect(rowsOf(work.identityId)).toEqual(['store_w'])
    const all = cards.flatMap((card) => card.vaults.map((row) => row.storeId))
    expect(new Set(all).size).toBe(all.length)
  })

  test('puts a local vault no identity claims on the first identity stored here', () => {
    const noCurrent: IdentityCardSource = {
      identities: [work, elsewhere],
      localVaults: [
        { storeId: 'store_w', label: 'Acme' },
        { storeId: 'store_orphan', label: 'Orphan' },
      ],
      currentLogVaults: [],
      openStoreId: '',
      authenticated: false,
      identityUnlocked: false,
    }
    const projection = new IdentityCardProjection(noCurrent)

    expect(projection.unlistedVaults).toEqual([])
    // With no identity in use here, its vaults stay openable: unlocking one
    // is how a lost identity key is recovered.
    expect(projection.cards[0]?.vaults).toEqual([
      {
        storeId: 'store_w',
        label: 'Acme',
        state: IdentityVaultRowState.Available,
      },
      {
        storeId: 'store_orphan',
        label: 'Orphan',
        state: IdentityVaultRowState.Available,
      },
    ])
  })

  test('lists local vaults apart only when no identity is stored here', () => {
    const onlyElsewhere: IdentityCardSource = {
      identities: [elsewhere],
      localVaults: [{ storeId: 'store_orphan', label: 'Orphan' }],
      currentLogVaults: [],
      openStoreId: '',
      authenticated: false,
      identityUnlocked: false,
    }

    const unlisted = new IdentityCardProjection(onlyElsewhere).unlistedVaults

    expect(unlisted.map((vault) => vault.storeId)).toEqual(['store_orphan'])
  })

  test('marks another identity vault stored here as opening through that identity', () => {
    const storedHere: IdentityCardSource = {
      ...source(true),
      localVaults: [
        ...source(true).localVaults,
        { storeId: 'store_w', label: 'Acme' },
      ],
    }

    const workCard = new IdentityCardProjection(storedHere).cards[1]

    expect(workCard?.vaults).toEqual([
      {
        storeId: 'store_w',
        label: 'Acme',
        state: IdentityVaultRowState.Dormant,
      },
    ])
  })

  test('lists no stray vaults when the current identity holds them all', () => {
    expect(new IdentityCardProjection(source(false)).unlistedVaults).toEqual([])
  })

  test('a stored vault still opens after this browser lost its identity key', () => {
    const lostKey: IdentityCardSource = {
      identities: [
        {
          ...personal,
          localAccess: NookIdentityLocalAccessKind.OtherInstallation,
        },
      ],
      localVaults: [{ storeId: 'store_a', label: 'Personal vault' }],
      currentLogVaults: [],
      openStoreId: '',
      authenticated: false,
      identityUnlocked: false,
    }

    const rows = new IdentityCardProjection(lostKey).cards.flatMap(
      (card) => card.vaults,
    )

    expect(rows.find((row) => row.storeId === 'store_a')?.state).toBe(
      IdentityVaultRowState.Available,
    )
    expect(rows.find((row) => row.storeId === 'store_gone')?.state).toBe(
      IdentityVaultRowState.Unavailable,
    )
  })
})

describe('IdentityCardProjection current identity vaults', () => {
  test('owns only the vaults on the current card, not another identity stored here', () => {
    // The Manage → Vaults list: "Travel test" in use must not list
    // "Personal vault", which belongs to the "Personal" identity.
    const travel: IdentityDirectoryEntry = {
      identityId: 'id_travel',
      label: 'Travel test',
      localAccess: NookIdentityLocalAccessKind.CurrentBrowser,
      members: [member('browser', DeviceAccessProtectionKind.PinOrPassphrase)],
      vaults: [vaultAccess('store_t', 'Trip')],
    }
    const storedPersonal: IdentityDirectoryEntry = {
      ...personal,
      localAccess: NookIdentityLocalAccessKind.ThisBrowser,
    }
    const twoIdentities: IdentityCardSource = {
      identities: [storedPersonal, travel],
      localVaults: [
        { storeId: 'store_a', label: 'Personal vault' },
        { storeId: 'store_t', label: 'Trip' },
        { storeId: 'store_new', label: 'Fresh' },
      ],
      currentLogVaults: ['store_t', 'store_away'],
      openStoreId: 'store_t',
      authenticated: true,
      identityUnlocked: true,
    }

    const owned = new IdentityCardProjection(twoIdentities).currentStoreIds

    expect([...owned].sort()).toEqual(['store_away', 'store_new', 'store_t'])
    expect(owned.has('store_a')).toBe(false)
  })

  test('owns nothing while no identity is in use here', () => {
    const noCurrent: IdentityCardSource = {
      identities: [work],
      localVaults: [{ storeId: 'store_w', label: 'Acme' }],
      currentLogVaults: [],
      openStoreId: '',
      authenticated: false,
      identityUnlocked: false,
    }

    expect(new IdentityCardProjection(noCurrent).currentStoreIds.size).toBe(0)
  })
})
