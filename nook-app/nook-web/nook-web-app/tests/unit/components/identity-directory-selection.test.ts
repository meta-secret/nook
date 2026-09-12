import { ok } from 'neverthrow'
import { fireEvent, render, waitFor } from '@testing-library/svelte'
import { describe, expect, test } from 'vitest'
import {
  DeviceAccessIdentityState,
  DeviceAccessProtectionKind,
  DeviceProtectionStatus,
  NookDeviceAccessTextKind,
  NookIdentityLocalAccessKind,
  NookIdentityDirectorySelectionKind,
  NookIdentityMemberLabelKind,
  NookPasskeyAttachmentState,
  NookPasskeyBackupState,
  NookPasskeyTimestampEvidenceKind,
  PasskeyKeeperKind,
  PasskeyObservedBrowser,
  PasskeyObservedPlatform,
  NookSelectedVaultIdentityContextKind,
  NookVaultManager,
} from '$app-wasm'
import { VaultStateTestFixture } from '../vault-state-test-fixture'
import type { VaultState } from '../../../../nook-web-shared/src/vault-app/lib/vault.svelte'
import DevicesAccessDashboard from '../../../../nook-web-shared/src/vault-app/lib/components/DevicesAccessDashboard.svelte'

const identities = [
  {
    identityId: 'personal',
    label: 'Personal',
    localAccess: NookIdentityLocalAccessKind.CurrentBrowser,
    members: [
      {
        appId: 'browser-app',
        label: 'Nook on MacBook',
        currentBrowser: true,
      },
    ],
    vaults: [],
  },
  {
    identityId: 'work',
    label: 'Work',
    localAccess: NookIdentityLocalAccessKind.OtherInstallation,
    members: [
      {
        appId: 'phone-app',
        label: 'Nook on work phone',
        currentBrowser: false,
      },
    ],
    vaults: [],
  },
] as const

let personalLocalAccess = NookIdentityLocalAccessKind.CurrentBrowser

function free(): void {}

function unknownText() {
  return {
    kind: NookDeviceAccessTextKind.Unknown,
    value: () => '',
    free,
    [Symbol.dispose]: free,
  }
}

function unavailableTime() {
  return {
    kind: NookPasskeyTimestampEvidenceKind.Unavailable,
    value: () => '',
    free,
    [Symbol.dispose]: free,
  }
}

function identitySnapshot(identity: (typeof identities)[number]) {
  return {
    appId: identity.members[0]?.appId ?? 'browser-app',
    appKeyCount: 1,
    controlEpoch: 1n,
    fingerprint: 'fingerprint-test',
    identityId: identity.identityId,
    label: identity.label,
    localAccess:
      identity.identityId === 'personal'
        ? personalLocalAccess
        : identity.localAccess,
    members: () =>
      identity.members.map((member) => ({
        appId: member.appId,
        currentBrowser: member.currentBrowser,
        localProtection:
          identity.identityId === 'personal'
            ? DeviceAccessProtectionKind.PasskeyStandard
            : DeviceAccessProtectionKind.Missing,
        labelKind: NookIdentityMemberLabelKind.Known,
        label: () => member.label,
        free,
        [Symbol.dispose]: free,
      })),
    vaults: () => [],
    vault_store_ids: () => [],
    vaultCount: 0,
    free,
    [Symbol.dispose]: free,
  }
}

const accessSnapshot = {
  protection: DeviceAccessProtectionKind.PasskeyStandard,
  identityState: DeviceAccessIdentityState.Unlocked,
  deviceId: unknownText(),
  credentialId: unknownText(),
  userHandleId: unknownText(),
  passkeyName: unknownText(),
  providerLabel: unknownText(),
  createdAt: unavailableTime(),
  lastUsedAt: unavailableTime(),
  attachment: NookPasskeyAttachmentState.Platform,
  transports: () => [],
  backupState: NookPasskeyBackupState.Unknown,
  aaguid: unknownText(),
  keeper: PasskeyKeeperKind.ApplePasswords,
  observedBrowser: PasskeyObservedBrowser.Unknown,
  observedPlatform: PasskeyObservedPlatform.Unknown,
  vaults: () => [],
  free,
  [Symbol.dispose]: free,
}

const directorySnapshot = {
  current_browser_identity: () => identitySnapshot(identities[0]),
  length: identities.length,
  selectionKind: NookIdentityDirectorySelectionKind.Selected,
  selectedVaultContextKind: NookSelectedVaultIdentityContextKind.Empty,
  selectedIdentityId: 'personal',
  identity: (index: number) =>
    index === 0
      ? identitySnapshot(identities[0])
      : identitySnapshot(identities[1]),
  device_access: () => accessSnapshot,
  free,
  [Symbol.dispose]: free,
}

const manager = new NookVaultManager()
manager.device_access_snapshot_request = () => ({
  resolve: async () => {
    expect.fail('dashboard must use identity-bound access evidence')
  },
  free,
  [Symbol.dispose]: free,
})
manager.identity_directory_snapshot_request = () => ({
  resolve: async () => directorySnapshot,
  free,
  [Symbol.dispose]: free,
})

const vaultFields = {
  locale: 'en',
  t: (key: string) => key,
  deviceProtectionStatus: DeviceProtectionStatus.Unlocked,
  localVaults: [],
  admitManager: () => ok(manager),
}
function createVault(): VaultState {
  const vault = VaultStateTestFixture.create()
  vault.deviceProtectionStatus = vaultFields.deviceProtectionStatus
  vault.openManager(manager)
  return vault
}

describe('identity directory selection', () => {
  test('switches the app inventory to an identity from another installation', async () => {
    personalLocalAccess = NookIdentityLocalAccessKind.CurrentBrowser
    const renderProps = {
      vault: createVault(),
      onBack: free,
      onManageVaultDevices: free,
      onManageVaultPasswords: free,
    }
    const rendered = render(DevicesAccessDashboard, renderProps)

    await waitFor(() =>
      expect(rendered.getByRole('button', { name: /Work/ })).toBeTruthy(),
    )

    await fireEvent.click(rendered.getByRole('button', { name: /Work/ }))

    expect(rendered.getByRole('heading', { name: 'Work' })).toBeTruthy()
    expect(rendered.getByText('Nook on work phone')).toBeTruthy()
    expect(
      rendered.getByTestId('devices-access-other-identity-notice'),
    ).toBeTruthy()
    expect(
      rendered
        .getByTestId('devices-access-layout-graph')
        .hasAttribute('disabled'),
    ).toBe(true)
    expect(
      rendered
        .getByTestId('devices-access-layout-list')
        .getAttribute('aria-pressed'),
    ).toBe('true')
    expect(() => rendered.getByText('Nook on MacBook')).toThrow()
  })

  test('returns to list when refreshed access makes the selected identity remote', async () => {
    personalLocalAccess = NookIdentityLocalAccessKind.CurrentBrowser
    const renderProps = {
      vault: createVault(),
      onBack: free,
      onManageVaultDevices: free,
      onManageVaultPasswords: free,
    }
    const rendered = render(DevicesAccessDashboard, renderProps)

    await waitFor(() =>
      expect(rendered.getByTestId('devices-access-layout-graph')).toBeTruthy(),
    )
    await fireEvent.click(rendered.getByTestId('devices-access-layout-graph'))
    expect(
      rendered
        .getByTestId('devices-access-layout-graph')
        .getAttribute('aria-pressed'),
    ).toBe('true')

    personalLocalAccess = NookIdentityLocalAccessKind.OtherInstallation
    await rendered.rerender({ ...renderProps, vault: createVault() })

    await waitFor(() =>
      expect(
        rendered
          .getByTestId('devices-access-layout-list')
          .getAttribute('aria-pressed'),
      ).toBe('true'),
    )
    expect(
      rendered
        .getByTestId('devices-access-layout-graph')
        .hasAttribute('disabled'),
    ).toBe(true)
    expect(rendered.getByTestId('devices-access-key-inventory')).toBeTruthy()
  })
})
