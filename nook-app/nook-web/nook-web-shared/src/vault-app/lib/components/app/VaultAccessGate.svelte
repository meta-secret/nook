<script lang="ts">
  import {
    configured_vault_application,
    type StartSentinelGenesisArgs,
  } from '$app-wasm'
  import LoginGate from '$lib/components/LoginGate.svelte'
  import PasskeyAuthOverlay from '$lib/components/PasskeyAuthOverlay.svelte'
  import VaultStatusBar from '$lib/components/VaultStatusBar.svelte'
  import { VaultStatusBarVariant } from '$lib/components/vault-status-bar-state'
  import type { VaultState } from '$lib/vault.svelte'

  const APP_KIND = configured_vault_application()

  let {
    vault,
    showAccessGate,
    existingVaultNeedsDeviceUnlock,
    usesExtensionDeviceIdentity,
    showPasskeyOverlay,
    sentinelInvitationRequest,
    sentinelParticipantResponse,
    sentinelOnboardingPackage,
    onUnlock,
    onUseEnrollmentCode,
    onAcceptSentinelOnboardingPackage,
    onUnlockWithPassword,
    onSwitchVault,
    onSentinelUnlocked,
    onCreateDeviceVault,
    onStartSentinelGenesis,
    onCreateSentinelParticipantKey,
    onCreateSentinelParticipantResponse,
    onDismissPasskey,
  }: {
    vault: VaultState
    showAccessGate: boolean
    existingVaultNeedsDeviceUnlock: boolean
    usesExtensionDeviceIdentity: boolean
    showPasskeyOverlay: boolean
    sentinelInvitationRequest: string
    sentinelParticipantResponse: string
    sentinelOnboardingPackage: string
    onUnlock: (skipExtensionDiscovery?: boolean) => Promise<void>
    onUseEnrollmentCode: (args: { readonly code: string; readonly password: string }) => Promise<void>
    onAcceptSentinelOnboardingPackage: (packageJson: string) => Promise<void>
    onUnlockWithPassword: (args: { readonly entryId: string; readonly password: string }) => Promise<void>
    onSwitchVault: () => Promise<void>
    onSentinelUnlocked: () => Promise<void>
    onCreateDeviceVault: (label: string) => Promise<void>
    onStartSentinelGenesis: (args: StartSentinelGenesisArgs) => Promise<boolean>
    onCreateSentinelParticipantKey: () => Promise<string>
    onCreateSentinelParticipantResponse: (
      requestPayload: string,
    ) => Promise<string>
    onDismissPasskey: () => void
  } = $props()

  const appVersion = '0.1.0'
</script>

<div class="space-y-6">
  {#if showAccessGate}
    {#if vault.providersLoaded || existingVaultNeedsDeviceUnlock}
      <LoginGate
        {vault}
        appKind={APP_KIND}
        providers={vault.providers}
        loginSetup={vault.loginSetup}
        bind:githubPat={vault.githubPat}
        bind:githubRepo={vault.githubRepo}
        addProviderOpen={vault.addProviderOpen}
        isVerifying={vault.isVerifying}
        isInitializing={vault.isInitializing}
        deviceAuthorizationPending={existingVaultNeedsDeviceUnlock}
        {usesExtensionDeviceIdentity}
        {onUnlock}
        onBeginAddProvider={() => vault.beginAddProvider()}
        onCancelAddProvider={() => vault.cancelAddProvider()}
        onBeginSetup={(setupRequest) => vault.beginProviderSetup(setupRequest)}
        onCancelSetup={() => vault.cancelProviderSetup()}
        onOpenHelp={() => vault.openHelp()}
        {onUseEnrollmentCode}
        prefillEnrollmentCode={vault.prefillEnrollmentCode}
        enrollmentFromUrlPending={vault.enrollmentFromUrlPending}
        {sentinelInvitationRequest}
        {sentinelParticipantResponse}
        {sentinelOnboardingPackage}
        {onAcceptSentinelOnboardingPackage}
        {onUnlockWithPassword}
        {onSwitchVault}
        {onSentinelUnlocked}
        {onCreateDeviceVault}
        {onStartSentinelGenesis}
        onCreateSentinelGenesisPublicKeyAnnouncement={onCreateSentinelParticipantKey}
        onCreateSentinelGenesisParticipantResponse={onCreateSentinelParticipantResponse}
        onRemoveProvider={(id) => vault.removeProvider(id)}
      />
      <VaultStatusBar
        {vault}
        storageMode={vault.storageMode}
        githubRepo={vault.githubRepo}
        lastSync={vault.lastSync}
        isSyncing={vault.isSyncActivityVisible}
        successMsg={vault.successMsg}
        errorMsg={vault.errorMsg}
        {appVersion}
        label="Nook"
        showSyncStatus={false}
        showStorageIcon={false}
        variant={VaultStatusBarVariant.Quiet}
        onDismissSuccess={() => vault.dismissSuccess()}
        onDismissError={() => vault.dismissError()}
      />
    {/if}
    {#if showPasskeyOverlay}
      <PasskeyAuthOverlay {vault} onDismiss={onDismissPasskey} />
    {/if}
  {/if}
</div>
