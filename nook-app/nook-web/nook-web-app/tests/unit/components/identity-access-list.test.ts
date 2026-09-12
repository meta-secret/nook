import { describe, expect, test, vi } from 'vitest'
import { render } from '@testing-library/svelte'
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
  KnownDashboardText,
  UnknownDashboardText,
  DashboardTimestampKind,
} from '../../../../nook-web-shared/src/vault-app/lib/components/devices-access-dashboard-state'
import { AccessChainStage } from '../../../../nook-web-shared/src/vault-app/lib/components/devices-access/access-chain'
import {
  IdentityAccessPresentation,
  IdentityAccessKeyKind,
} from '../../../../nook-web-shared/src/vault-app/lib/components/devices-access/identity-access-list'
import type { IdentityDirectoryEntry } from '../../../../nook-web-shared/src/vault-app/lib/components/devices-access/identity-directory-view'
import {
  IdentityKeyInventory,
  IdentityKeyInventoryRowKind,
} from '../../../../nook-web-shared/src/vault-app/lib/components/devices-access/identity-key-inventory'
import IdentityKeyInventoryComponent from '../../../../nook-web-shared/src/vault-app/lib/components/devices-access/IdentityKeyInventory.svelte'
import { PasskeyCardSummaryKind } from '../../../../nook-web-shared/src/vault-app/lib/components/devices-access/passkey-card'
import { VaultStateTestFixture } from '../vault-state-test-fixture'

const known = (value: string): DashboardText => new KnownDashboardText(value)

const unknownText: DashboardText = new UnknownDashboardText()

const knownTime: DashboardTimestamp = {
  kind: DashboardTimestampKind.Known,
  value: '2026-03-01T12:00:00.000',
}

type TranslationRequest =
  | string
  | {
      readonly key: string
      readonly replacements: Readonly<Record<string, string>>
    }

const vault = VaultStateTestFixture.create()
vi.spyOn(vault, 't').mockImplementation((request: TranslationRequest) =>
  typeof request === 'string'
    ? request
    : `${request.key}(${JSON.stringify(request.replacements)})`,
)

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
    const buildIdentityAccessCardsArgs: ConstructorParameters<
      typeof IdentityAccessPresentation
    >[0] = {
      vault,
      view: passkeyView(),
    }
    const cards = new IdentityAccessPresentation(buildIdentityAccessCardsArgs)
      .cards
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({
      kind: IdentityAccessKeyKind.Passkey,
      stage: AccessChainStage.Unlock,
      title: 'Work laptop',
      typeLabel: I18N_KEYS.DevicesAccessKeyTypePasskey,
      passkeySummary: {
        kind: PasskeyCardSummaryKind.Present,
        summary: {
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
            {
              kind: 'created',
              label: I18N_KEYS.DevicesAccessCreated,
              value: 'Mar 1, 2026, 12:00 PM',
            },
            {
              kind: 'last-used',
              label: I18N_KEYS.DevicesAccessLastUsedColumn,
              value: 'Mar 1, 2026, 12:00 PM',
            },
          ],
        },
      },
    })
  })

  test('keeps the app as subordinate context when a passkey protects it', () => {
    const buildIdentityAccessCardsArgs: ConstructorParameters<
      typeof IdentityAccessPresentation
    >[0] = {
      vault,
      view: passkeyView(),
    }
    const cards = new IdentityAccessPresentation(buildIdentityAccessCardsArgs)
      .cards
    expect(cards.map((card) => card.kind)).toEqual([
      IdentityAccessKeyKind.Passkey,
    ])
  })

  test('keeps an unnamed passkey title when the keeper is unknown', () => {
    const buildIdentityAccessCardsArgs: ConstructorParameters<
      typeof IdentityAccessPresentation
    >[0] = {
      vault,
      view: {
        ...passkeyView(),
        passkeyName: unknownText,
      },
    }
    const cards = new IdentityAccessPresentation(buildIdentityAccessCardsArgs)
      .cards
    expect(cards[0]?.title).toBe(I18N_KEYS.DevicesAccessPasskeyUnnamed)
  })
})

describe('identity key inventory', () => {
  test('renders connected apps without a local Add app action', () => {
    const addAppLabel = 'Add app'
    const addAppHelper =
      'Another Nook installation must request identity enrollment before it can be added.'
    const renderedVault = VaultStateTestFixture.create()
    vi.spyOn(renderedVault, 't').mockImplementation(
      (request: TranslationRequest) => {
        const key = typeof request === 'string' ? request : request.key
        if (key === 'devices_access.add_key') return addAppLabel
        if (key === 'devices_access.add_key_unavailable') return addAppHelper
        return vault.t(request)
      },
    )
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
      ],
      vaults: [],
    }

    const rendered = render(IdentityKeyInventoryComponent, {
      vault: renderedVault,
      identity,
      view: passkeyView(),
      onRenamePasskey: async () => true,
    })

    expect(rendered.getByTestId('devices-access-app').textContent).toContain(
      'Nook on MacBook',
    )
    expect(
      rendered.queryByRole('button', { name: addAppLabel }),
    ).not.toBeTruthy()
    expect(rendered.queryByText(addAppHelper)).not.toBeTruthy()
  })

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
    const buildIdentityKeyInventoryArgs: ConstructorParameters<
      typeof IdentityKeyInventory
    >[0] = { vault, identity, view }

    const rows = new IdentityKeyInventory(buildIdentityKeyInventoryArgs).rows

    expect(rows.map((row) => row.kind)).toEqual([
      IdentityKeyInventoryRowKind.Protector,
      IdentityKeyInventoryRowKind.Apps,
    ])
    const protector = rows[0]
    if (!protector) expect.fail('protector row is required')
    expect(protector.title).toBe('Work laptop')
    expect(protector.kind).toBe(IdentityKeyInventoryRowKind.Protector)
    expect(protector.passkeySummary.kind).toBe(PasskeyCardSummaryKind.Present)
    if (protector.passkeySummary.kind === PasskeyCardSummaryKind.Present) {
      expect(protector.passkeySummary.summary.title).toBe('Work laptop')
      expect(protector.passkeySummary.summary.facts.map((fact) => fact.value)).toEqual(
        expect.arrayContaining(['passkey_1234', 'Proton Pass']),
      )
    }
    expect(protector.apps).toEqual([
      expect.objectContaining({ title: 'Nook on MacBook', appId: 'device_5678' }),
    ])
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
    const buildIdentityKeyInventoryArgs: ConstructorParameters<
      typeof IdentityKeyInventory
    >[0] = { vault, identity, view }

    const rows = new IdentityKeyInventory(buildIdentityKeyInventoryArgs).rows

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
    const buildIdentityKeyInventoryArgs: ConstructorParameters<
      typeof IdentityKeyInventory
    >[0] = { vault, identity, view }

    const rows = new IdentityKeyInventory(buildIdentityKeyInventoryArgs).rows

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
    const buildIdentityKeyInventoryArgs: ConstructorParameters<
      typeof IdentityKeyInventory
    >[0] = { vault, identity, view }

    const rows = new IdentityKeyInventory(buildIdentityKeyInventoryArgs).rows

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
    const buildIdentityKeyInventoryArgs: ConstructorParameters<
      typeof IdentityKeyInventory
    >[0] = { vault, identity, view }

    const rows = new IdentityKeyInventory(buildIdentityKeyInventoryArgs).rows

    expect(rows).toHaveLength(1)
    expect(rows[0]?.kind).toBe(IdentityKeyInventoryRowKind.Apps)
  })
})
