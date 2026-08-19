import { describe, expect, test } from 'vitest'
import {
  DeviceAccessIdentityState,
  DeviceAccessProtectionKind,
  NookPasskeyAttachmentState,
  NookPasskeyBackupState,
  PasskeyKeeperKind,
  PasskeyObservedBrowser,
  PasskeyObservedPlatform,
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

function passkeyView(keeper: PasskeyKeeperKind): DashboardView {
  return {
    protection: DeviceAccessProtectionKind.PasskeyStandard,
    identityState: DeviceAccessIdentityState.Unlocked,
    deviceId: known('device_5678'),
    credentialId: known('passkey_1234'),
    userHandleId: unknownText,
    passkeyName: known('Work laptop'),
    providerLabel: unknownText,
    createdAt: knownTime,
    lastUsedAt: knownTime,
    attachment: NookPasskeyAttachmentState.Platform,
    transports: [],
    backupState: NookPasskeyBackupState.Unknown,
    aaguid: known('fbfc3007-154e-4ecc-8c0b-6e020557d7bd'),
    keeper,
    observedBrowser: PasskeyObservedBrowser.Unknown,
    observedPlatform: PasskeyObservedPlatform.Unknown,
    vaults: [],
  }
}

describe('identity access cards', () => {
  test('names a passkey by its browser-reported keeper', () => {
    const buildIdentityAccessCardsArgs: Parameters<
      typeof buildIdentityAccessCards
    >[0] = {
      vault,
      view: passkeyView(PasskeyKeeperKind.ApplePasswords),
    }
    const cards = buildIdentityAccessCards(buildIdentityAccessCardsArgs)
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({
      kind: IdentityAccessKeyKind.Passkey,
      stage: AccessChainStage.Unlock,
      title: I18N_KEYS.DevicesAccessKeeperApplePasswords,
      typeLabel: I18N_KEYS.DevicesAccessKeyTypePasskey,
      description: I18N_KEYS.DevicesAccessKeeperStorageApplePasswords,
    })
  })

  test('omits a sibling app-key card when a passkey already unwraps that key', () => {
    const buildIdentityAccessCardsArgs: Parameters<
      typeof buildIdentityAccessCards
    >[0] = {
      vault,
      view: passkeyView(PasskeyKeeperKind.ApplePasswords),
    }
    const cards = buildIdentityAccessCards(buildIdentityAccessCardsArgs)
    expect(cards.map((card) => card.kind)).toEqual([
      IdentityAccessKeyKind.Passkey,
    ])
  })

  test('names a Proton Pass keeper from the same browser-reported map', () => {
    const buildIdentityAccessCardsArgs: Parameters<
      typeof buildIdentityAccessCards
    >[0] = {
      vault,
      view: passkeyView(PasskeyKeeperKind.ProtonPass),
    }
    const cards = buildIdentityAccessCards(buildIdentityAccessCardsArgs)
    expect(cards[0]).toMatchObject({
      kind: IdentityAccessKeyKind.Passkey,
      title: I18N_KEYS.DevicesAccessKeeperProtonPass,
      typeLabel: I18N_KEYS.DevicesAccessKeyTypePasskey,
      description: I18N_KEYS.DevicesAccessKeeperStorageProtonPass,
    })
  })

  test('keeps an unnamed passkey title when the keeper is unknown', () => {
    const buildIdentityAccessCardsArgs: Parameters<
      typeof buildIdentityAccessCards
    >[0] = {
      vault,
      view: {
        ...passkeyView(PasskeyKeeperKind.Unknown),
        passkeyName: unknownText,
      },
    }
    const cards = buildIdentityAccessCards(buildIdentityAccessCardsArgs)
    expect(cards[0]?.title).toBe(I18N_KEYS.DevicesAccessPasskeyUnnamed)
    expect(cards[0]?.description).toBe(
      I18N_KEYS.DevicesAccessKeeperStorageUnknown,
    )
  })
})
