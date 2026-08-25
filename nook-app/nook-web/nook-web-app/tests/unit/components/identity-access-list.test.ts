import { describe, expect, test } from 'vitest'
import {
  DeviceAccessIdentityState,
  DeviceAccessProtectionKind,
  NookIdentityLocalAccessKind,
  PasskeyKeeperKind,
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

type TranslationRequest =
  | string
  | {
      readonly key: string
      readonly replacements: Readonly<Record<string, string>>
    }

const vault = {
  locale: 'en',
  t: (request: TranslationRequest) =>
    typeof request === 'string'
      ? request
      : `${request.key}(${JSON.stringify(request.replacements)})`,
} as VaultState

function passkeyView(): DashboardView {
  return {
    protection: DeviceAccessProtectionKind.PasskeyStandard,
    identityState: DeviceAccessIdentityState.Unlocked,
    deviceId: known('device_5678'),
    credentialId: known('passkey_1234'),
    passkeyName: known('Work laptop'),
    providerLabel: known('Proton Pass'),
    createdAt: knownTime,
    lastUsedAt: knownTime,
    keeper: PasskeyKeeperKind.ProtonPass,
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
      passkeySummary: {
        title: 'Work laptop',
        facts: [
          {
            kind: 'fingerprint',
            label: I18N_KEYS.DevicesAccessCredentialId,
            value: 'passkey_1234',
          },
          {
            kind: 'keeper',
            label: I18N_KEYS.DevicesAccessKeeperLabel,
            value: 'Proton Pass',
          },
        ],
      },
    })
  })

  test('keeps the app as subordinate context when a passkey protects it', () => {
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
  test('nests the protected app and keeps remote apps in a linked group', () => {
    const view = passkeyView()
    const identity: IdentityDirectoryEntry = {
      identityId: 'identity_personal',
      label: 'Personal',
      localAccess: NookIdentityLocalAccessKind.CurrentBrowser,
      members: [
        {
          appId: 'device_5678',
          label: known('Nook on MacBook'),
          currentBrowser: true,
          localProtection: DeviceAccessProtectionKind.PasskeyStandard,
        },
        {
          appId: 'device_peer',
          label: known('Nook on phone'),
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
      IdentityKeyInventoryRowKind.Apps,
    ])
    expect(rows[0]).toMatchObject({
      title: 'Work laptop',
      passkeySummary: {
        title: 'Work laptop',
        facts: expect.arrayContaining([
          expect.objectContaining({ value: 'passkey_1234' }),
          expect.objectContaining({ value: 'Proton Pass' }),
        ]),
      },
      apps: [
        {
          title: 'Nook on MacBook',
          appId: 'device_5678',
        },
      ],
    })
    expect(rows[1]).toMatchObject({
      apps: [
        {
          title: 'Nook on phone',
          appId: 'device_peer',
        },
      ],
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
          label: known('Nook on work phone'),
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
      kind: IdentityKeyInventoryRowKind.Apps,
      apps: [
        {
          title: 'Nook on work phone',
          relationship: `${I18N_KEYS.DevicesAccessAppLinkedToIdentity}(${JSON.stringify({ identity: 'Work' })})`,
        },
      ],
    })
  })

  test('distinguishes unlabeled apps without exposing their identifiers', () => {
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

    expect(rows[0]?.apps.map((app) => app.title)).toEqual([
      `${I18N_KEYS.DevicesAccessOtherAppKey}(${JSON.stringify({ count: '1' })})`,
      `${I18N_KEYS.DevicesAccessOtherAppKey}(${JSON.stringify({ count: '2' })})`,
    ])
    expect(rows[0]?.apps.map((app) => app.appId)).toEqual([
      'app_peer_12345678',
      'app_peer_87654321',
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

    expect(rows[0]).toMatchObject({
      kind: IdentityKeyInventoryRowKind.Protector,
      apps: [
        {
          title: I18N_KEYS.DevicesAccessCompanionSession,
        },
      ],
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
          label: known('Nook in this browser'),
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
    expect(rows[0]?.kind).toBe(IdentityKeyInventoryRowKind.Apps)
  })
})
