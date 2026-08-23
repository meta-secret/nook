import { describe, expect, test } from 'vitest'
import {
  DeviceAccessIdentityState,
  DeviceAccessProtectionKind,
  NookIdentityLocalAccessKind,
} from '$app-wasm'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import {
  type DashboardText,
  type DashboardTimestamp,
  type DashboardView,
  DashboardTextKind,
  DashboardTimestampKind,
} from '../../../../nook-web-shared/src/vault-app/lib/components/devices-access-dashboard-state'
import { AccessChainStage } from '../../../../nook-web-shared/src/vault-app/lib/components/devices-access/access-chain'
import {
  buildIdentityAccessCards,
  IdentityAccessKeyKind,
} from '../../../../nook-web-shared/src/vault-app/lib/components/devices-access/identity-access-list'
import type { IdentityDirectoryEntry } from '../../../../nook-web-shared/src/vault-app/lib/components/devices-access/identity-directory-view'
import {
  buildIdentityKeyInventory,
  IdentityKeyInventoryRowKind,
} from '../../../../nook-web-shared/src/vault-app/lib/components/devices-access/identity-key-inventory'
import type { VaultState } from '../../../../nook-web-shared/src/vault-app/lib/vault.svelte'

const known = (value: string): DashboardText => ({
  kind: DashboardTextKind.Known,
  value,
})

const unknownText: DashboardText = { kind: DashboardTextKind.Unknown }

const knownTime: DashboardTimestamp = {
  kind: DashboardTimestampKind.Known,
  value: '2026-03-01T12:00:00.000Z',
}

const vault = {
  locale: 'en',
  t: (key: string, replacements?: Record<string, string>) =>
    replacements ? `${key}(${JSON.stringify(replacements)})` : key,
} as VaultState

function passkeyView(): DashboardView {
  return {
    protection: DeviceAccessProtectionKind.PasskeyStandard,
    identityState: DeviceAccessIdentityState.Unlocked,
    deviceId: known('device_5678'),
    credentialId: known('passkey_1234'),
    passkeyName: known('Work laptop'),
    lastUsedAt: knownTime,
    vaults: [],
  }
}

describe('identity access cards', () => {
  test('names a passkey by its editable Nook name', () => {
    const buildIdentityAccessCardsArgs: Parameters<
      typeof buildIdentityAccessCards
    >[0] = {
      vault,
      view: passkeyView(),
    }
    const cards = buildIdentityAccessCards(buildIdentityAccessCardsArgs)
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({
      kind: IdentityAccessKeyKind.Passkey,
      stage: AccessChainStage.Unlock,
      title: 'Work laptop',
      typeLabel: I18N_KEYS.DevicesAccessKeyTypePasskey,
    })
  })

  test('omits a sibling app-key card when a passkey already unwraps that key', () => {
    const buildIdentityAccessCardsArgs: Parameters<
      typeof buildIdentityAccessCards
    >[0] = {
      vault,
      view: passkeyView(),
    }
    const cards = buildIdentityAccessCards(buildIdentityAccessCardsArgs)
    expect(cards.map((card) => card.kind)).toEqual([
      IdentityAccessKeyKind.Passkey,
    ])
  })

  test('keeps an unnamed passkey title when the keeper is unknown', () => {
    const buildIdentityAccessCardsArgs: Parameters<
      typeof buildIdentityAccessCards
    >[0] = {
      vault,
      view: {
        ...passkeyView(),
        passkeyName: unknownText,
      },
    }
    const cards = buildIdentityAccessCards(buildIdentityAccessCardsArgs)
    expect(cards[0]?.title).toBe(I18N_KEYS.DevicesAccessPasskeyUnnamed)
  })
})

describe('identity key inventory', () => {
  test('lists the protector and every app key as separate rows', () => {
    const view = passkeyView()
    const identity: IdentityDirectoryEntry = {
      identityId: 'identity_personal',
      label: 'Personal',
      localAccess: NookIdentityLocalAccessKind.CurrentBrowser,
      members: [
        {
          appId: 'device_5678',
          label: known('MacBook app key'),
          currentBrowser: true,
          localProtection: DeviceAccessProtectionKind.PasskeyStandard,
        },
        {
          appId: 'device_peer',
          label: known('Phone app key'),
          currentBrowser: false,
          localProtection: DeviceAccessProtectionKind.Missing,
        },
      ],
      vaults: [],
    }
    const buildIdentityKeyInventoryArgs: Parameters<
      typeof buildIdentityKeyInventory
    >[0] = { vault, identity, view }

    const rows = buildIdentityKeyInventory(buildIdentityKeyInventoryArgs)

    expect(rows.map((row) => row.kind)).toEqual([
      IdentityKeyInventoryRowKind.Protector,
      IdentityKeyInventoryRowKind.AppKey,
      IdentityKeyInventoryRowKind.AppKey,
    ])
    expect(rows[0]).toMatchObject({
      title: 'Work laptop',
      protector: I18N_KEYS.DevicesAccessThisBrowser,
    })
    expect(rows[1]).toMatchObject({
      title: 'MacBook app key',
      protector: 'Work laptop',
      lastUsed: I18N_KEYS.DevicesAccessUnknown,
    })
    expect(rows[2]).toMatchObject({
      title: 'Phone app key',
      lastUsed: I18N_KEYS.DevicesAccessUnknown,
    })
  })

  test('does not borrow current-browser evidence for another identity', () => {
    const view = passkeyView()
    const identity: IdentityDirectoryEntry = {
      identityId: 'identity_work',
      label: 'Work',
      localAccess: NookIdentityLocalAccessKind.OtherInstallation,
      members: [
        {
          appId: 'device_peer',
          label: known('Work phone app key'),
          currentBrowser: false,
          localProtection: DeviceAccessProtectionKind.Missing,
        },
      ],
      vaults: [],
    }
    const buildIdentityKeyInventoryArgs: Parameters<
      typeof buildIdentityKeyInventory
    >[0] = { vault, identity, view }

    const rows = buildIdentityKeyInventory(buildIdentityKeyInventoryArgs)

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      kind: IdentityKeyInventoryRowKind.AppKey,
      title: 'Work phone app key',
      lastUsed: I18N_KEYS.DevicesAccessUnknown,
    })
  })

  test('distinguishes unlabeled peer app keys by public identifier', () => {
    const view = passkeyView()
    const identity: IdentityDirectoryEntry = {
      identityId: 'identity_work',
      label: 'Work',
      localAccess: NookIdentityLocalAccessKind.OtherInstallation,
      members: [
        {
          appId: 'app_peer_12345678',
          label: unknownText,
          currentBrowser: false,
          localProtection: DeviceAccessProtectionKind.Missing,
        },
        {
          appId: 'app_peer_87654321',
          label: unknownText,
          currentBrowser: false,
          localProtection: DeviceAccessProtectionKind.Missing,
        },
      ],
      vaults: [],
    }
    const buildIdentityKeyInventoryArgs: Parameters<
      typeof buildIdentityKeyInventory
    >[0] = { vault, identity, view }

    const rows = buildIdentityKeyInventory(buildIdentityKeyInventoryArgs)

    expect(rows.map((row) => row.title)).toEqual([
      `${I18N_KEYS.DevicesAccessOtherAppKey} · 12345678`,
      `${I18N_KEYS.DevicesAccessOtherAppKey} · 87654321`,
    ])
  })

  test('labels the live companion member as companion-owned', () => {
    const view = passkeyView()
    view.protection = DeviceAccessProtectionKind.CompanionSession
    const identity: IdentityDirectoryEntry = {
      identityId: 'identity_work',
      label: 'Work',
      localAccess: NookIdentityLocalAccessKind.CurrentBrowser,
      members: [
        {
          appId: 'app_companion_12345678',
          label: unknownText,
          currentBrowser: true,
          localProtection: DeviceAccessProtectionKind.CompanionSession,
        },
      ],
      vaults: [],
    }
    const buildIdentityKeyInventoryArgs: Parameters<
      typeof buildIdentityKeyInventory
    >[0] = { vault, identity, view }

    const rows = buildIdentityKeyInventory(buildIdentityKeyInventoryArgs)

    expect(rows[1]).toMatchObject({
      title: `${I18N_KEYS.DevicesAccessCompanionSession} · 12345678`,
      protector: I18N_KEYS.DevicesAccessCompanionSession,
    })
  })

  test('does not invent a protector for an unprepared browser', () => {
    const view = passkeyView()
    view.protection = DeviceAccessProtectionKind.Missing
    const identity: IdentityDirectoryEntry = {
      identityId: 'identity_personal',
      label: 'Personal',
      localAccess: NookIdentityLocalAccessKind.CurrentBrowser,
      members: [
        {
          appId: 'device_5678',
          label: known('Browser app key'),
          currentBrowser: true,
          localProtection: DeviceAccessProtectionKind.Missing,
        },
      ],
      vaults: [],
    }
    const buildIdentityKeyInventoryArgs: Parameters<
      typeof buildIdentityKeyInventory
    >[0] = { vault, identity, view }

    const rows = buildIdentityKeyInventory(buildIdentityKeyInventoryArgs)

    expect(rows).toHaveLength(1)
    expect(rows[0]?.kind).toBe(IdentityKeyInventoryRowKind.AppKey)
  })
})
