import { beforeAll, describe, expect, test } from 'vitest'
import initNookWasm, {
  DeviceMode,
  NookVaultArchitecture,
  OnboardingType,
  ReplicationType,
  VaultType,
  enrollment_provider_for_architecture,
  enrollment_shared_provider_for_architecture,
} from '$app-wasm'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import type { StorageProvider } from '$lib/auth/providers'
import {
  ProviderFixtureCredentials,
  ProviderRowFixture,
} from '../provider-fixtures'
import {
  vault_architecture_can_create_secret,
  CompatibleProviderPreferenceKind,
  CompatibleProviderSelectionKind,
  default_vault_architecture,
  firstCompatibleProvider,
  vault_architecture_onboarding_type,
  providerCapabilityLabelKey,
  provider_kind_replication_capability,
  provider_onboarding_type,
  ReplicationSupport,
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
  return ProviderRowFixture.googleDrive(ProviderRowFixture.unscoped('drive-1'))
}

function githubProvider(): StorageProvider {
  return ProviderRowFixture.github(ProviderRowFixture.unscoped('github-1'))
}

function sharedICloudProvider(): StorageProvider {
  return ProviderRowFixture.icloud(
    ProviderRowFixture.unscoped('icloud-shared-1'),
  )
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

  test('the companion handoff transfers the Drive session for the vault folder', () => {
    const enrollmentProvider = enrollment_provider_for_architecture(
      googleDriveProvider(),
      default_vault_architecture(),
    )

    expect(enrollmentProvider.onboardingType).toBe(
      OnboardingType.PersonalCredentialTransfer,
    )
    expect(enrollmentProvider.oauthAccessToken).toBe(
      ProviderFixtureCredentials.DRIVE_TOKEN,
    )
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
    expect(driveCapability.kind).toEqual({
      type: 'oauth-file',
      preset: 'google-drive',
    })
    expect(driveCapability.supports(ReplicationType.Personal)).toBe(
      ReplicationSupport.Supported,
    )
    expect(driveCapability.supports(ReplicationType.Shared)).toBe(
      ReplicationSupport.Supported,
    )
    expect(driveCapability.sharedJoinerIdentity).toBe('email')
    const validatedCapability = validate_provider_replication(
      googleDriveProvider(),
      ReplicationType.Shared,
    )
    expect(validatedCapability.kind).toEqual(driveCapability.kind)
    expect(validatedCapability.sharedJoinerIdentity).toBe('email')

    expect(() =>
      validate_provider_replication(githubProvider(), ReplicationType.Shared),
    ).toThrow(
      /errors\.validation\.unsupported_provider_replication:github:shared/,
    )
  })

  test('the capability label key comes from Rust', () => {
    expect(providerCapabilityLabelKey(githubProvider())).toBe(
      I18N_KEYS.ProviderPickerCapabilityPersonalOnly,
    )
    expect(providerCapabilityLabelKey(googleDriveProvider())).toBe(
      I18N_KEYS.ProviderPickerCapabilityPersonalShared,
    )
    const s3 = provider_kind_replication_capability({ type: 's3' })
    try {
      expect(s3.labelKey).toBe(I18N_KEYS.ProviderPickerCapabilityPersonalOnly)
    } finally {
      s3.free()
    }
  })

  test('provider presentation selects only rows Rust accepts for the vault mode', () => {
    const github = githubProvider()
    const drive = googleDriveProvider()
    const providers = [github, drive]

    expect(provider_supports_replication(github, ReplicationType.Shared)).toBe(
      ReplicationSupport.Unsupported,
    )
    expect(provider_supports_replication(drive, ReplicationType.Shared)).toBe(
      ReplicationSupport.Supported,
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

  test('a shared Drive enrollment names the saved folder and carries no credential', () => {
    const architecture = validateVaultArchitecture({
      device_mode: DeviceMode.Standard,
      vault_type: VaultType.Simple,
      replication_type: ReplicationType.Shared,
    })
    const enrollmentProvider = enrollment_shared_provider_for_architecture(
      googleDriveProvider(),
      architecture,
      'joiner@example.com',
    )
    expect(enrollmentProvider.isSharedProviderGrant).toBe(true)
    expect(enrollmentProvider.onboardingType).toBe(
      OnboardingType.SharedProviderGrant,
    )
    expect(enrollmentProvider.sharedStorageTargetId).toBe(
      ProviderFixtureCredentials.DRIVE_FOLDER,
    )
  })

  test('Drive invites never transfer credentials, even in a personal vault', () => {
    const architecture = default_vault_architecture()
    const provider = googleDriveProvider()

    expect(provider_onboarding_type(provider, architecture)).toBe(
      OnboardingType.SharedProviderGrant,
    )
    const enrollmentProvider = enrollment_shared_provider_for_architecture(
      provider,
      architecture,
      'joiner@example.com',
    )
    expect(enrollmentProvider.isSharedProviderGrant).toBe(true)
    expect(enrollmentProvider.sharedStorageTargetId).toBe(
      ProviderFixtureCredentials.DRIVE_FOLDER,
    )
    expect(() => enrollmentProvider.oauthAccessToken).toThrow()
  })

  test('shared iCloud enrollment sends the CloudKit target and the invited account', () => {
    const provider = sharedICloudProvider()
    const architecture = default_vault_architecture()
    const capability = provider_replication_capability(provider)
    expect(capability.kind).toEqual({ type: 'oauth-file', preset: 'icloud' })
    expect(capability.supports(ReplicationType.Shared)).toBe(
      ReplicationSupport.Supported,
    )
    expect(provider_onboarding_type(provider, architecture)).toBe(
      OnboardingType.SharedProviderGrant,
    )
    const enrollmentProvider = enrollment_shared_provider_for_architecture(
      provider,
      architecture,
      'member@icloud.com',
    )
    expect(enrollmentProvider.isSharedProviderGrant).toBe(true)
    expect(enrollmentProvider.oauthPreset).toBe('icloud')
    expect(enrollmentProvider.sharedJoinerIdentity).toBe('member@icloud.com')
    expect(enrollmentProvider.sharedStorageTargetId).toBe(
      ProviderFixtureCredentials.ICLOUD_SHARE,
    )
    expect(() => enrollmentProvider.oauthAccessToken).toThrow()
  })
})
