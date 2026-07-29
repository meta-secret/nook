import { omittedValue } from '../../../../nook-web-shared/src/explicit-state'
import { beforeAll, describe, expect, test } from 'vitest'
import initNookWasm, {
  DeviceMode,
  NookVaultArchitecture,
  OnboardingType,
  VaultType,
  enrollmentProviderForArchitecture,
} from '$app-wasm'
import type { StorageProvider } from '$lib/auth-providers'
import { takeWasmStringValue } from '$lib/wasm-string-value'
import {
  canCreateSecret,
  defaultVaultArchitecture,
  firstCompatibleProvider,
  onboardingType,
  providerCapabilityLabelKey,
  providerOnboardingType,
  providerReplicationCapability,
  providerSupportsReplication,
  validateProviderReplication,
  validateVaultArchitecture,
  type VaultArchitectureDraft,
} from '$lib/vault-architecture'

beforeAll(async () => {
  await initNookWasm()
})

function googleDriveProvider(): StorageProvider {
  return {
    id: 'drive-1',
    type: 'oauth-file',
    label: 'Google Drive',
    oauthFile: {
      preset: 'google-drive',
      accessToken: 'ya29.test',
      fileName: 'nook.yaml',
      accountEmail: 'alex@example.com',
      driveMode: 'private',
      iCloudMode: 'private',
    },
    createdAt: '2026-07-08T00:00:00.000Z',
  }
}

function githubProvider(): StorageProvider {
  return {
    id: 'github-1',
    type: 'github',
    label: 'GitHub',
    githubRepo: 'nook-vault',
    githubPat: 'github_pat_test',
    createdAt: '2026-07-08T00:00:00.000Z',
  }
}

function sharedICloudProvider(): StorageProvider {
  return {
    id: 'icloud-shared-1',
    type: 'oauth-file',
    label: 'iCloud',
    oauthFile: {
      preset: 'icloud',
      accessToken: 'cloudkit-web-token',
      fileName: 'nook-events',
      driveMode: 'private',
      iCloudMode: 'shared',
      iCloudShareTarget:
        'icloud-share-v1:{"role":"owner","zoneName":"zone","ownerRecordName":"owner","rootRecordName":"root","shortGuid":"guid"}',
    },
    createdAt: '2026-07-14T00:00:00.000Z',
  }
}

function privateICloudProvider(): StorageProvider {
  return {
    ...sharedICloudProvider(),
    id: 'icloud-private-1',
    oauthFile: {
      preset: 'icloud',
      accessToken: 'cloudkit-web-token',
      fileName: 'nook-events',
      driveMode: 'private',
      iCloudMode: 'private',
    },
  }
}

describe('vault architecture adapter', () => {
  test('defaults select the simple personal standard vault', () => {
    const architecture = defaultVaultArchitecture()
    expect({
      device_mode: architecture.device_mode,
      vault_type: architecture.vault_type,
      replication_type: architecture.replication_type,
    }).toEqual({
      device_mode: DeviceMode.Standard,
      vault_type: VaultType.Simple,
      replication_type: 'personal',
    })
    expect(onboardingType(architecture)).toBe('personal-credential-transfer')
  })

  test('draft construction delegates vault-specific defaults to Rust', () => {
    const simple = NookVaultArchitecture.draft(
      DeviceMode.AntiHacker,
      VaultType.Simple,
      'shared',
    )
    const sentinel = NookVaultArchitecture.draft(
      DeviceMode.Standard,
      VaultType.Sentinel,
      'personal',
    )
    try {
      expect(() => simple.sentinel_threshold).toThrow(
        'errors.validation.invalid_sentinel_policy',
      )
      expect(simple.replication_type).toBe('shared')
      expect(sentinel.sentinel_threshold).toBe(2)
      expect(sentinel.sentinel_required_participants).toBe(2)
      expect(sentinel.sentinel_ready_participants).toBe(0)
    } finally {
      simple.free()
      sentinel.free()
    }
  })

  test('private provider enrollment exposes the credential-transfer mode', () => {
    const enrollmentProvider = enrollmentProviderForArchitecture(
      googleDriveProvider(),
      defaultVaultArchitecture(),
      omittedValue(),
      omittedValue(),
    )

    expect(enrollmentProvider.onboardingType).toBe(
      OnboardingType.PersonalCredentialTransfer,
    )
    expect(takeWasmStringValue(enrollmentProvider.oauthAccessToken)).toBe(
      'ya29.test',
    )
  })

  test('sentinel vaults are gated until their policy is ready', () => {
    const draft: VaultArchitectureDraft = {
      device_mode: DeviceMode.AntiHacker,
      vault_type: VaultType.Sentinel,
      replication_type: 'shared',
      sentinel: {
        threshold: 2,
        required_participants: 3,
        ready_participants: 1,
      },
    }

    const architecture = validateVaultArchitecture(draft)
    expect(architecture.vault_type).toBe(VaultType.Sentinel)
    expect(architecture.sentinel_threshold).toBe(2)
    expect(architecture.sentinel_required_participants).toBe(3)
    expect(architecture.sentinel_ready_participants).toBe(1)
    expect(canCreateSecret(architecture)).toBe(false)
    expect(onboardingType(architecture)).toBe('shared-provider-grant')
  })

  test('round-trips the Sentinel wire shape', () => {
    const normalized = validateVaultArchitecture({
      device_mode: DeviceMode.Standard,
      vault_type: VaultType.Sentinel,
      replication_type: 'personal',
      sentinel: {
        threshold: 2,
        required_participants: 3,
        ready_participants: 0,
      },
    })

    expect({
      device_mode: normalized.device_mode,
      vault_type: normalized.vault_type,
      replication_type: normalized.replication_type,
      sentinel_threshold: normalized.sentinel_threshold,
      sentinel_required_participants: normalized.sentinel_required_participants,
      sentinel_ready_participants: normalized.sentinel_ready_participants,
    }).toEqual({
      device_mode: DeviceMode.Standard,
      vault_type: VaultType.Sentinel,
      replication_type: 'personal',
      sentinel_threshold: 2,
      sentinel_required_participants: 3,
      sentinel_ready_participants: 0,
    })
  })

  test('provider matrix allows shared Google Drive and rejects shared GitHub', () => {
    const driveCapability = providerReplicationCapability(googleDriveProvider())
    expect(driveCapability.providerType).toBe('oauth-file')
    expect(takeWasmStringValue(driveCapability.oauthPreset)).toBe(
      'google-drive',
    )
    expect(driveCapability.supportsPersonal).toBe(true)
    expect(driveCapability.supportsShared).toBe(true)
    expect(takeWasmStringValue(driveCapability.sharedJoinerIdentity)).toBe(
      'email',
    )
    const validatedCapability = validateProviderReplication(
      googleDriveProvider(),
      'shared',
    )
    expect(validatedCapability.providerType).toBe(driveCapability.providerType)
    expect(takeWasmStringValue(validatedCapability.oauthPreset)).toBe(
      'google-drive',
    )
    expect(validatedCapability.supportsPersonal).toBe(true)
    expect(validatedCapability.supportsShared).toBe(true)
    expect(takeWasmStringValue(validatedCapability.sharedJoinerIdentity)).toBe(
      'email',
    )

    expect(() =>
      validateProviderReplication(githubProvider(), 'shared'),
    ).toThrow(
      /errors\.validation\.unsupported_provider_replication:github::shared/,
    )
  })

  test('provider presentation selects only rows Rust accepts for the vault mode', () => {
    const github = githubProvider()
    const drive = googleDriveProvider()
    const providers = [github, drive]

    expect(providerCapabilityLabelKey(github)).toBe(
      'provider_picker.capability_personal_only',
    )
    expect(providerCapabilityLabelKey(drive)).toBe(
      'provider_picker.capability_personal_shared',
    )
    expect(providerSupportsReplication(github, 'shared')).toBe(false)
    expect(providerSupportsReplication(drive, 'shared')).toBe(true)
    expect(firstCompatibleProvider(providers, 'shared', github.id)).toBe(drive)
    expect(firstCompatibleProvider(providers, 'personal', github.id)).toBe(
      github,
    )
    expect(
      firstCompatibleProvider([github], 'shared', github.id),
    ).toBeUndefined()
  })

  test('private iCloud rows require shared setup before shared onboarding', () => {
    const privateICloud = privateICloudProvider()
    const sharedICloud = sharedICloudProvider()

    expect(providerSupportsReplication(privateICloud, 'personal')).toBe(true)
    expect(providerSupportsReplication(privateICloud, 'shared')).toBe(false)
    expect(providerSupportsReplication(sharedICloud, 'shared')).toBe(true)
    expect(
      firstCompatibleProvider(
        [privateICloud, sharedICloud],
        'shared',
        privateICloud.id,
      )?.id,
    ).toBe(sharedICloud.id)
  })

  test('WASM refuses to emit a shared enrollment provider without a storage target', () => {
    const architecture = validateVaultArchitecture({
      device_mode: DeviceMode.Standard,
      vault_type: VaultType.Simple,
      replication_type: 'shared',
    })
    const provider = googleDriveProvider()

    expect(() =>
      enrollmentProviderForArchitecture(
        provider,
        architecture,
        'joiner@example.com',
        omittedValue(),
      ),
    ).toThrow(/shared_storage_target_required/)

    const enrollmentProvider = enrollmentProviderForArchitecture(
      provider,
      architecture,
      'joiner@example.com',
      'shared-folder-abc',
    )
    expect(enrollmentProvider.isSharedProviderGrant).toBe(true)
    expect(enrollmentProvider.onboardingType).toBe(
      OnboardingType.SharedProviderGrant,
    )
    expect(takeWasmStringValue(enrollmentProvider.sharedStorageTargetId)).toBe(
      'shared-folder-abc',
    )
  })

  test('shared Drive provider mode overrides personal credential transfer', () => {
    const architecture = defaultVaultArchitecture()
    const provider: StorageProvider = {
      ...googleDriveProvider(),
      oauthFile: {
        ...googleDriveProvider().oauthFile!,
        driveMode: 'shared',
        folderId: 'persisted-shared-folder',
      },
    }

    expect(providerOnboardingType(provider, architecture)).toBe(
      'shared-provider-grant',
    )
    const enrollmentProvider = enrollmentProviderForArchitecture(
      provider,
      architecture,
      'joiner@example.com',
      omittedValue(),
    )
    expect(enrollmentProvider.isSharedProviderGrant).toBe(true)
    expect(enrollmentProvider.onboardingType).toBe(
      OnboardingType.SharedProviderGrant,
    )
    expect(takeWasmStringValue(enrollmentProvider.sharedStorageTargetId)).toBe(
      'persisted-shared-folder',
    )
    expect(
      takeWasmStringValue(enrollmentProvider.oauthAccessToken),
    ).toBeUndefined()
    expect(
      takeWasmStringValue(enrollmentProvider.oauthRefreshToken),
    ).toBeUndefined()
  })

  test('shared iCloud enrollment sends only the CloudKit target', () => {
    const provider = sharedICloudProvider()
    const architecture = defaultVaultArchitecture()
    const capability = providerReplicationCapability(provider)
    expect(capability.providerType).toBe('oauth-file')
    expect(takeWasmStringValue(capability.oauthPreset)).toBe('icloud')
    expect(capability.supportsPersonal).toBe(true)
    expect(capability.supportsShared).toBe(true)
    expect(providerOnboardingType(provider, architecture)).toBe(
      'shared-provider-grant',
    )
    const enrollmentProvider = enrollmentProviderForArchitecture(
      provider,
      architecture,
      omittedValue(),
      omittedValue(),
    )
    expect(enrollmentProvider.isSharedProviderGrant).toBe(true)
    expect(enrollmentProvider.onboardingType).toBe(
      OnboardingType.SharedProviderGrant,
    )
    expect(takeWasmStringValue(enrollmentProvider.oauthPreset)).toBe('icloud')
    expect(
      takeWasmStringValue(enrollmentProvider.sharedJoinerIdentity),
    ).toBeUndefined()
    expect(takeWasmStringValue(enrollmentProvider.sharedStorageTargetId)).toBe(
      provider.oauthFile?.iCloudShareTarget,
    )
    expect(
      takeWasmStringValue(enrollmentProvider.oauthAccessToken),
    ).toBeUndefined()
  })
})
