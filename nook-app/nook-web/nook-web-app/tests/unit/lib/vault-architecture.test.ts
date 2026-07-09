import { beforeAll, describe, expect, test } from 'vitest'
import initNookWasm from '$lib/nook-wasm/nook_wasm'
import type { StorageProvider } from '$lib/auth-providers'
import {
  canCreateSecret,
  defaultVaultArchitecture,
  onboardingType,
  providerReplicationCapability,
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

  test('nexus vaults are gated until their policy is ready', () => {
    const draft: VaultArchitecture = {
      device_mode: 'anti-hacker',
      vault_type: 'nexus',
      replication_type: 'shared',
      nexus: {
        threshold: 2,
        required_participants: 3,
        ready_participants: 1,
      },
    }

    expect(validateVaultArchitecture(draft)).toEqual(draft)
    expect(canCreateSecret(draft)).toBe(false)
    expect(onboardingType(draft)).toBe('shared-provider-grant')
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
    expect(validateProviderReplication(googleDriveProvider(), 'shared')).toEqual(
      driveCapability,
    )

    expect(() => validateProviderReplication(githubProvider(), 'shared')).toThrow(
      /errors\.validation\.unsupported_provider_replication:github::shared/,
    )
  })
})
