import { fireEvent, render } from '@testing-library/svelte'
import { describe, expect, test } from 'vitest'
import {
  DeviceAccessIdentityState,
  DeviceAccessProtectionKind,
  NookIdentityLocalAccessKind,
  NookPasskeyAttachmentState,
  NookPasskeyBackupState,
  PasskeyKeeperKind,
  PasskeyObservedBrowser,
  PasskeyObservedPlatform,
} from '$app-wasm'
import type { IdentityDirectoryEntry } from '../../../../nook-web-shared/src/vault-app/lib/components/devices-access/identity-directory-view'
import type { VaultState } from '../../../../nook-web-shared/src/vault-app/lib/vault.svelte'
import IdentityDirectorySelectionHarness from './fixtures/IdentityDirectorySelectionHarness.svelte'
import {
  DashboardTextKind,
  DashboardTimestampKind,
  type DashboardView,
} from '../../../../nook-web-shared/src/vault-app/lib/components/devices-access-dashboard-state'

const unknownText = { kind: DashboardTextKind.Unknown } as const
const unavailableTime = { kind: DashboardTimestampKind.Unavailable } as const
const vault = {
  locale: 'en',
  t: (key: string) => key,
} as VaultState

const view: DashboardView = {
  protection: DeviceAccessProtectionKind.PasskeyStandard,
  identityState: DeviceAccessIdentityState.Unlocked,
  deviceId: { kind: DashboardTextKind.Known, value: 'browser-app' },
  credentialId: unknownText,
  userHandleId: unknownText,
  passkeyName: { kind: DashboardTextKind.Known, value: 'MacBook passkey' },
  providerLabel: unknownText,
  createdAt: unavailableTime,
  lastUsedAt: unavailableTime,
  attachment: NookPasskeyAttachmentState.Platform,
  transports: [],
  backupState: NookPasskeyBackupState.Unknown,
  aaguid: unknownText,
  keeper: PasskeyKeeperKind.ApplePasswords,
  observedBrowser: PasskeyObservedBrowser.Unknown,
  observedPlatform: PasskeyObservedPlatform.Unknown,
  vaults: [],
}

const identities: readonly IdentityDirectoryEntry[] = [
  {
    identityId: 'personal',
    label: 'Personal',
    localAccess: NookIdentityLocalAccessKind.CurrentBrowser,
    members: [
      {
        appId: 'browser-app',
        label: { kind: DashboardTextKind.Known, value: 'MacBook app key' },
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
        label: { kind: DashboardTextKind.Known, value: 'Work phone app key' },
        currentBrowser: false,
      },
    ],
    vaults: [],
  },
]

describe('identity directory selection', () => {
  test('switches the key inventory to an identity from another installation', async () => {
    const rendered = render(IdentityDirectorySelectionHarness, {
      vault,
      view,
      identities,
      initialIdentityId: 'personal',
    })

    await fireEvent.click(rendered.getByRole('button', { name: /Work/ }))

    expect(rendered.getByRole('heading', { name: 'Work' })).toBeTruthy()
    expect(rendered.getByText('Work phone app key')).toBeTruthy()
    expect(rendered.getByTestId('other-installation-evidence')).toBeTruthy()
    expect(
      rendered
        .getByTestId('devices-access-identity-details')
        .hasAttribute('disabled'),
    ).toBe(true)
    expect(() => rendered.getByText('MacBook app key')).toThrow()
  })
})
