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
  NookVaultManager,
} from '$app-wasm'
import { VaultState } from '../../../../nook-web-shared/src/vault-app/lib/vault.svelte'
import DevicesAccessDashboard from '../../../../nook-web-shared/src/vault-app/lib/components/DevicesAccessDashboard.svelte'

const identities = [
  {
    identityId: 'personal',
    label: 'Personal',
    localAccess: NookIdentityLocalAccessKind.CurrentBrowser,
    members: [
      {
        appId: 'browser-app',
        label: 'MacBook app key',
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
        label: 'Work phone app key',
        currentBrowser: false,
      },
    ],
    vaults: [],
  },
] as const

function free(): void {}

function unknownText() {
  return { kind: NookDeviceAccessTextKind.Unknown, free }
}

function unavailableTime() {
  return { kind: NookPasskeyTimestampEvidenceKind.Unavailable, free }
}

function identitySnapshot(identity: (typeof identities)[number]) {
  return {
    identityId: identity.identityId,
    label: identity.label,
    localAccess: identity.localAccess,
    members: () =>
      identity.members.map((member) => ({
        appId: member.appId,
        currentBrowser: member.currentBrowser,
        labelKind: NookIdentityMemberLabelKind.Known,
        label: () => member.label,
        free,
      })),
    vaults: () => [],
    free,
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
}

const directorySnapshot = {
  length: identities.length,
  selectionKind: NookIdentityDirectorySelectionKind.Selected,
  selectedIdentityId: 'personal',
  identity: (index: number) =>
    index === 0
      ? identitySnapshot(identities[0])
      : identitySnapshot(identities[1]),
  free,
}

const managerMethods = {
  device_access_snapshot_request: () => ({
    resolve: async () => accessSnapshot,
    free,
  }),
  identity_directory_snapshot_request: () => ({
    resolve: async () => directorySnapshot,
    free,
  }),
}
const manager: NookVaultManager = Object.assign(
  Object.create(NookVaultManager.prototype),
  managerMethods,
)

const vaultFields = {
  locale: 'en',
  t: (key: string) => key,
  deviceProtectionStatus: DeviceProtectionStatus.Unlocked,
  localVaults: [],
  requireManager: () => manager,
}
const vault: VaultState = Object.assign(
  Object.create(VaultState.prototype),
  vaultFields,
)

describe('identity directory selection', () => {
  test('switches the key inventory to an identity from another installation', async () => {
    const renderProps = {
      vault,
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
    expect(rendered.getByText('Work phone app key')).toBeTruthy()
    expect(
      rendered.getByTestId('devices-access-other-identity-notice'),
    ).toBeTruthy()
    expect(
      rendered
        .getByTestId('devices-access-identity-details')
        .hasAttribute('disabled'),
    ).toBe(true)
    expect(() => rendered.getByText('MacBook app key')).toThrow()
  })
})
