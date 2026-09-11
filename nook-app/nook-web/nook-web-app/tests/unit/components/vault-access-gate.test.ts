import { render } from '@testing-library/svelte'
import type { ComponentProps } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import type { VaultState } from '$lib/vault.svelte'
import VaultAccessGate from '../../../../nook-web-shared/src/vault-app/lib/components/app/VaultAccessGate.svelte'

describe('vault access gate', () => {
  test('shows a startup failure before provider loading makes login available', () => {
    const vault = {
      providersLoaded: false,
      errorMsg: 'Provider startup failed',
      devicesAccessIdentityTransitionPending: false,
      isAuthenticated: false,
      storageMode: 'local',
      githubRepo: '',
      lastSync: {},
      isSyncActivityVisible: false,
      successMsg: '',
      t: vi.fn((key: string) => key),
      dismissSuccess: vi.fn(),
      dismissError: vi.fn(),
    } as unknown as VaultState

    const props = {
      vault,
      showAccessGate: false,
      existingVaultNeedsDeviceUnlock: false,
      usesExtensionDeviceIdentity: false,
      showPasskeyOverlay: false,
      sentinelInvitationRequest: '',
      sentinelParticipantResponsePending: false,
      sentinelParticipantResponse: '',
      sentinelOnboardingPackage: '',
      onUnlock: vi.fn(async () => {}),
      onUseEnrollmentCode: vi.fn(async () => {}),
      onAcceptSentinelOnboardingPackage: vi.fn(async () => {}),
      onUnlockWithPassword: vi.fn(async () => {}),
      onSwitchVault: vi.fn(async () => {}),
      onSentinelUnlocked: vi.fn(async () => {}),
      onCreateDeviceVault: vi.fn(async () => {}),
      onStartSentinelGenesis: vi.fn(async () => false),
      onCreateSentinelParticipantKey: vi.fn(async () => {
        throw new Error('Not used in startup failure presentation')
      }),
      onCreateSentinelParticipantResponse: vi.fn(async () => {
        throw new Error('Not used in startup failure presentation')
      }),
      onDismissPasskey: vi.fn(),
    } satisfies ComponentProps<typeof VaultAccessGate>
    const view = render(VaultAccessGate, props)

    expect(view.getByTestId('vault-error').textContent).toContain(
      'Provider startup failed',
    )
    expect(view.queryAllByTestId('login-gate')).toHaveLength(0)
  })
})
