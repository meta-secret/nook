import { beforeAll, describe, expect, test } from 'vitest'
import initNookWasm, {
  enrollmentProviderForArchitecture,
} from '$lib/nook-wasm/nook_wasm'
import type { StorageProvider } from '$lib/auth-providers'
import {
  canCreateSecret,
  defaultVaultArchitecture,
  firstCompatibleProvider,
  onboardingType,
  providerCapabilityLabelKey,
  providerReplicationCapability,
  providerSupportsReplication,
  validateProviderReplication,
  validateVaultArchitecture,
  type VaultArchitecture,
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

describe('vault architecture adapter', () => {
  test('defaults preserve the legacy simple personal standard vault', () => {
    expect(defaultVaultArchitecture()).toEqual({
      device_mode: 'standard',
      vault_type: 'simple',
      replication_type: 'personal',
    })
    expect(onboardingType(defaultVaultArchitecture())).toBe(
      'personal-credential-transfer',
    )
  })

  test('sentinel vaults are gated until their policy is ready', () => {
    const draft: VaultArchitecture = {
      device_mode: 'anti-hacker',
      vault_type: 'sentinel',
      replication_type: 'shared',
      sentinel: {
        threshold: 2,
        required_participants: 3,
        ready_participants: 1,
      },
    }

    expect(validateVaultArchitecture(draft)).toEqual(draft)
    expect(canCreateSecret(draft)).toBe(false)
    expect(onboardingType(draft)).toBe('shared-provider-grant')
  })

  test('round-trips the Sentinel wire shape', () => {
    const normalized = validateVaultArchitecture({
      device_mode: 'standard',
      vault_type: 'sentinel',
      replication_type: 'personal',
      sentinel: {
        threshold: 2,
        required_participants: 3,
        ready_participants: 0,
      },
    })

    expect(normalized).toEqual({
      device_mode: 'standard',
      vault_type: 'sentinel',
      replication_type: 'personal',
      sentinel: {
        threshold: 2,
        required_participants: 3,
        ready_participants: 0,
      },
    })
  })

  test('provider matrix allows shared Google Drive and rejects shared GitHub', () => {
    const driveCapability = providerReplicationCapability(googleDriveProvider())
    expect(driveCapability).toMatchObject({
      providerType: 'oauth-file',
      oauthPreset: 'google-drive',
      supportsPersonal: true,
      supportsShared: true,
      sharedJoinerIdentity: 'email',
    })
    expect(
      validateProviderReplication(googleDriveProvider(), 'shared'),
    ).toEqual(driveCapability)

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

  test('WASM refuses to emit a shared enrollment provider without a storage target', () => {
    const architecture: VaultArchitecture = {
      device_mode: 'standard',
      vault_type: 'simple',
      replication_type: 'shared',
    }
    const provider = googleDriveProvider()

    expect(() =>
      enrollmentProviderForArchitecture(
        provider,
        architecture,
        'joiner@example.com',
        undefined,
      ),
    ).toThrow(/shared_storage_target_required/)

    const enrollmentProvider = enrollmentProviderForArchitecture(
      provider,
      architecture,
      'joiner@example.com',
      'shared-folder-abc',
    )
    expect(enrollmentProvider.isSharedProviderGrant).toBe(true)
    expect(enrollmentProvider.sharedStorageTargetId).toBe('shared-folder-abc')
  })
})
