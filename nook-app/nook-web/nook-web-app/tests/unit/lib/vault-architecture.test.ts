import { beforeAll, describe, expect, test } from 'vitest'
import initNookWasm, {
  DeviceMode,
  NookVaultArchitecture,
  OnboardingType,
  ReplicationType,
  VaultType,
  enrollment_icloud_shared_provider_for_architecture,
  enrollment_provider_for_architecture,
  enrollment_shared_provider_for_architecture,
} from '$app-wasm'
import {
  configuredOAuthFile,
  DEFAULT_DRIVE_BACKUP_NAME,
  defaultOAuthFileConfig,
  isConfiguredOAuthFile,
  providerPersistenceDefaults,
  storedGithubPat,
  storedGithubRepository,
  storedGoogleDriveFolder,
  storedICloudShareTarget,
  storedOAuthAccountEmail,
  storedOAuthCredential,
  storedOAuthRemoteFileName,
  type StorageProvider,
} from '$lib/auth/providers'
import {
  vault_architecture_can_create_secret,
  CompatibleProviderPreferenceKind,
  CompatibleProviderSelectionKind,
  default_vault_architecture,
  firstCompatibleProvider,
  vault_architecture_onboarding_type,
  providerCapabilityLabelKey,
  ProviderCapabilityLabelKey,
  provider_onboarding_type,
  provider_replication_capability,
  provider_supports_replication,
  validate_provider_replication,
  validateVaultArchitecture,
  type VaultArchitectureDraft,
} from '$lib/vault/architecture-model'

beforeAll(async () => {
  await initNookWasm()
})

function googleDriveProvider(): StorageProvider {
  return {
    ...providerPersistenceDefaults(),
    id: 'drive-1',
    type: 'oauth-file',
    label: 'Google Drive',
    oauthFile: configuredOAuthFile({
      ...defaultOAuthFileConfig({
        preset: 'google-drive',
        fileName: DEFAULT_DRIVE_BACKUP_NAME,
      }),
      accessToken: storedOAuthCredential('ya29.test'),
      fileName: storedOAuthRemoteFileName('nook.yaml'),
      accountEmail: storedOAuthAccountEmail('alex@example.com'),
    }),
    syncCheckpoint: { state: 'neverSynced' },
    createdAt: '2026-07-08T00:00:00.000Z',
  }
}

function githubProvider(): StorageProvider {
  return {
    ...providerPersistenceDefaults(),
    id: 'github-1',
    type: 'github',
    label: 'GitHub',
    githubRepo: storedGithubRepository('nook-vault'),
    githubPat: storedGithubPat('github_pat_test'),
    syncCheckpoint: { state: 'neverSynced' },
    createdAt: '2026-07-08T00:00:00.000Z',
  }
}

const ICLOUD_SHARED_TARGET =
  'icloud-share-v1:{"role":"owner","zoneName":"zone","ownerRecordName":"owner","rootRecordName":"root","shortGuid":"guid"}'

function sharedICloudProvider(): StorageProvider {
  return {
    ...providerPersistenceDefaults(),
    id: 'icloud-shared-1',
    type: 'oauth-file',
    label: 'iCloud',
    oauthFile: configuredOAuthFile({
      ...defaultOAuthFileConfig({
        preset: 'icloud',
        fileName: DEFAULT_DRIVE_BACKUP_NAME,
      }),
      accessToken: storedOAuthCredential('cloudkit-web-token'),
      driveMode: 'private',
      iCloudMode: 'shared',
      iCloudShareTarget: storedICloudShareTarget(ICLOUD_SHARED_TARGET),
    }),
    syncCheckpoint: { state: 'neverSynced' },
    createdAt: '2026-07-14T00:00:00.000Z',
  }
}

function privateICloudProvider(): StorageProvider {
  return {
    ...sharedICloudProvider(),
    id: 'icloud-private-1',
    oauthFile: configuredOAuthFile({
      ...defaultOAuthFileConfig({
        preset: 'icloud',
        fileName: DEFAULT_DRIVE_BACKUP_NAME,
      }),
      accessToken: storedOAuthCredential('cloudkit-web-token'),
    }),
  }
}

describe('vault architecture adapter', () => {
  test('defaults select the simple personal standard vault', () => {
    const architecture = default_vault_architecture()
    expect({
      device_mode: architecture.device_mode,
      vault_type: architecture.vault_type,
      replication_type: architecture.replication_type,
    }).toEqual({
      device_mode: DeviceMode.Standard,
      vault_type: VaultType.Simple,
      replication_type: ReplicationType.Personal,
    })
    expect(vault_architecture_onboarding_type(architecture)).toBe(
      OnboardingType.PersonalCredentialTransfer,
    )
  })

  test('draft construction delegates vault-specific defaults to Rust', () => {
    const simple = NookVaultArchitecture.draft(
      DeviceMode.AntiHacker,
      VaultType.Simple,
      ReplicationType.Shared,
    )
    const sentinel = NookVaultArchitecture.draft(
      DeviceMode.Standard,
      VaultType.Sentinel,
      ReplicationType.Personal,
    )
    try {
      expect(() => simple.sentinel_threshold).toThrow(
        'errors.validation.invalid_sentinel_policy',
      )
      expect(simple.replication_type).toBe(ReplicationType.Shared)
      expect(sentinel.sentinel_threshold).toBe(2)
      expect(sentinel.sentinel_required_participants).toBe(2)
      expect(sentinel.sentinel_ready_participants).toBe(0)
    } finally {
      simple.free()
      sentinel.free()
    }
  })

  test('private provider enrollment exposes the credential-transfer mode', () => {
    const enrollmentProvider = enrollment_provider_for_architecture(
      googleDriveProvider(),
      default_vault_architecture(),
    )

    expect(enrollmentProvider.onboardingType).toBe(
      OnboardingType.PersonalCredentialTransfer,
    )
    expect(enrollmentProvider.oauthAccessToken).toBe('ya29.test')
  })

  test('sentinel vaults are gated until their policy is ready', () => {
    const draft: VaultArchitectureDraft = {
      device_mode: DeviceMode.AntiHacker,
      vault_type: VaultType.Sentinel,
      replication_type: ReplicationType.Shared,
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
    expect(vault_architecture_can_create_secret(architecture)).toBe(false)
    expect(vault_architecture_onboarding_type(architecture)).toBe(
      OnboardingType.SharedProviderGrant,
    )
  })

  test('round-trips the Sentinel wire shape', () => {
    const normalized = validateVaultArchitecture({
      device_mode: DeviceMode.Standard,
      vault_type: VaultType.Sentinel,
      replication_type: ReplicationType.Personal,
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
      replication_type: ReplicationType.Personal,
      sentinel_threshold: 2,
      sentinel_required_participants: 3,
      sentinel_ready_participants: 0,
    })
  })

  test('provider matrix allows shared Google Drive and rejects shared GitHub', () => {
    const driveCapability = provider_replication_capability(
      googleDriveProvider(),
    )
    expect(driveCapability.providerType).toBe('oauth-file')
    expect(driveCapability.oauthPreset).toBe('google-drive')
    expect(driveCapability.supportsPersonal).toBe(true)
    expect(driveCapability.supportsShared).toBe(true)
    expect(driveCapability.sharedJoinerIdentity).toBe('email')
    const validatedCapability = validate_provider_replication(
      googleDriveProvider(),
      ReplicationType.Shared,
    )
    expect(validatedCapability.providerType).toBe(driveCapability.providerType)
    expect(validatedCapability.oauthPreset).toBe('google-drive')
    expect(validatedCapability.supportsPersonal).toBe(true)
    expect(validatedCapability.supportsShared).toBe(true)
    expect(validatedCapability.sharedJoinerIdentity).toBe('email')

    expect(() =>
      validate_provider_replication(githubProvider(), ReplicationType.Shared),
    ).toThrow(
      /errors\.validation\.unsupported_provider_replication:github::shared/,
    )
  })

  test('provider presentation selects only rows Rust accepts for the vault mode', () => {
    const github = githubProvider()
    const drive = googleDriveProvider()
    const providers = [github, drive]

    expect(providerCapabilityLabelKey(github)).toBe(
      ProviderCapabilityLabelKey.PersonalOnly,
    )
    expect(providerCapabilityLabelKey(drive)).toBe(
      ProviderCapabilityLabelKey.PersonalShared,
    )
    expect(provider_supports_replication(github, ReplicationType.Shared)).toBe(
      false,
    )
    expect(provider_supports_replication(drive, ReplicationType.Shared)).toBe(
      true,
    )
    expect(
      firstCompatibleProvider({
        providers: providers,
        replicationType: ReplicationType.Shared,
        preference: {
          kind: CompatibleProviderPreferenceKind.Selected,
          providerId: github.id,
        },
      }),
    ).toEqual({
      kind: CompatibleProviderSelectionKind.Selected,
      provider: drive,
    })
    expect(
      firstCompatibleProvider({
        providers: providers,
        replicationType: ReplicationType.Personal,
        preference: {
          kind: CompatibleProviderPreferenceKind.Selected,
          providerId: github.id,
        },
      }),
    ).toEqual({
      kind: CompatibleProviderSelectionKind.Selected,
      provider: github,
    })
    expect(
      firstCompatibleProvider({
        providers: [github],
        replicationType: ReplicationType.Shared,
        preference: {
          kind: CompatibleProviderPreferenceKind.Selected,
          providerId: github.id,
        },
      }),
    ).toEqual({ kind: CompatibleProviderSelectionKind.Unavailable })
  })

  test('private iCloud rows require shared setup before shared onboarding', () => {
    const privateICloud = privateICloudProvider()
    const sharedICloud = sharedICloudProvider()

    expect(
      provider_supports_replication(privateICloud, ReplicationType.Personal),
    ).toBe(true)
    expect(
      provider_supports_replication(privateICloud, ReplicationType.Shared),
    ).toBe(false)
    expect(
      provider_supports_replication(sharedICloud, ReplicationType.Shared),
    ).toBe(true)
    expect(
      firstCompatibleProvider({
        providers: [privateICloud, sharedICloud],
        replicationType: ReplicationType.Shared,
        preference: {
          kind: CompatibleProviderPreferenceKind.Selected,
          providerId: privateICloud.id,
        },
      }),
    ).toEqual({
      kind: CompatibleProviderSelectionKind.Selected,
      provider: sharedICloud,
    })
  })

  test('WASM refuses to emit a shared enrollment provider without a storage target', () => {
    const architecture = validateVaultArchitecture({
      device_mode: DeviceMode.Standard,
      vault_type: VaultType.Simple,
      replication_type: ReplicationType.Shared,
    })
    const provider = googleDriveProvider()

    expect(() =>
      enrollment_shared_provider_for_architecture(
        provider,
        architecture,
        'joiner@example.com',
        '',
      ),
    ).toThrow(/shared_storage_target_required/)

    const enrollmentProvider = enrollment_shared_provider_for_architecture(
      provider,
      architecture,
      'joiner@example.com',
      'shared-folder-abc',
    )
    expect(enrollmentProvider.isSharedProviderGrant).toBe(true)
    expect(enrollmentProvider.onboardingType).toBe(
      OnboardingType.SharedProviderGrant,
    )
    expect(enrollmentProvider.sharedStorageTargetId).toBe('shared-folder-abc')
  })

  test('shared Drive provider mode overrides personal credential transfer', () => {
    const architecture = default_vault_architecture()
    const baseProvider = googleDriveProvider()
    const baseConfiguration = baseProvider.oauthFile
    if (!isConfiguredOAuthFile(baseConfiguration)) {
      throw new Error('expected configured Google Drive provider')
    }
    const provider: StorageProvider = {
      ...baseProvider,
      oauthFile: configuredOAuthFile({
        ...baseConfiguration.config,
        driveMode: 'shared',
        folderId: storedGoogleDriveFolder('persisted-shared-folder'),
      }),
    }

    expect(provider_onboarding_type(provider, architecture)).toBe(
      OnboardingType.SharedProviderGrant,
    )
    const enrollmentProvider = enrollment_shared_provider_for_architecture(
      provider,
      architecture,
      'joiner@example.com',
      'persisted-shared-folder',
    )
    expect(enrollmentProvider.isSharedProviderGrant).toBe(true)
    expect(enrollmentProvider.onboardingType).toBe(
      OnboardingType.SharedProviderGrant,
    )
    expect(enrollmentProvider.sharedStorageTargetId).toBe(
      'persisted-shared-folder',
    )
    expect(() => enrollmentProvider.oauthAccessToken).toThrow()
    expect(() => enrollmentProvider.oauthRefresh).toThrow()
  })

  test('shared iCloud enrollment sends only the CloudKit target', () => {
    const provider = sharedICloudProvider()
    const architecture = default_vault_architecture()
    const capability = provider_replication_capability(provider)
    expect(capability.providerType).toBe('oauth-file')
    expect(capability.oauthPreset).toBe('icloud')
    expect(capability.supportsPersonal).toBe(true)
    expect(capability.supportsShared).toBe(true)
    expect(provider_onboarding_type(provider, architecture)).toBe(
      OnboardingType.SharedProviderGrant,
    )
    const enrollmentProvider =
      enrollment_icloud_shared_provider_for_architecture(
        provider,
        architecture,
        ICLOUD_SHARED_TARGET,
      )
    expect(enrollmentProvider.isSharedProviderGrant).toBe(true)
    expect(enrollmentProvider.onboardingType).toBe(
      OnboardingType.SharedProviderGrant,
    )
    expect(enrollmentProvider.oauthPreset).toBe('icloud')
    expect(() => enrollmentProvider.sharedJoinerIdentity).toThrow()
    expect(enrollmentProvider.sharedStorageTargetId).toBe(ICLOUD_SHARED_TARGET)
    expect(() => enrollmentProvider.oauthAccessToken).toThrow()
  })
})
