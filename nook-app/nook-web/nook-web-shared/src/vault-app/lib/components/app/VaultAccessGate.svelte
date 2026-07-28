<script lang="ts">
  import type { StartSentinelGenesisArgs } from "$app-wasm";
  import { APP_KIND } from "$lib/app-kind";
  import LoginGate from "$lib/components/LoginGate.svelte";
  import PasskeyAuthOverlay from "$lib/components/PasskeyAuthOverlay.svelte";
  import VaultStatusBar from "$lib/components/VaultStatusBar.svelte";
  import type { VaultState } from "$lib/vault.svelte";

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
    vault: VaultState;
    showAccessGate: boolean;
    existingVaultNeedsDeviceUnlock: boolean;
    usesExtensionDeviceIdentity: boolean;
    showPasskeyOverlay: boolean;
    sentinelInvitationRequest: string;
    sentinelParticipantResponse: string;
    sentinelOnboardingPackage: string;
    onUnlock: (skipExtensionDiscovery?: boolean) => Promise<void>;
    onUseEnrollmentCode: (code: string, password: string) => Promise<void>;
    onAcceptSentinelOnboardingPackage: (
      packageJson: string,
    ) => Promise<void>;
    onUnlockWithPassword: (
      entryId: string,
      password: string,
    ) => Promise<void>;
    onSwitchVault: () => Promise<void>;
    onSentinelUnlocked: () => Promise<void>;
    onCreateDeviceVault: (label: string) => Promise<void>;
    onStartSentinelGenesis: (
      args: StartSentinelGenesisArgs,
    ) => Promise<boolean>;
    onCreateSentinelParticipantKey: () => Promise<string>;
    onCreateSentinelParticipantResponse: (
      requestPayload: string,
    ) => Promise<string>;
    onDismissPasskey: () => void;
  } = $props();

  const appVersion = "0.1.0";
</script>

<div class="space-y-6">
  {#if showAccessGate}
    {#if vault.providersLoaded || existingVaultNeedsDeviceUnlock}
      <LoginGate
        {vault}
        appKind={APP_KIND}
        providers={vault.providers}
        bind:setupType={vault.loginSetupType}
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
        onBeginSetup={(type, preset) => vault.beginProviderSetup(type, preset)}
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
        lastSyncedAt={vault.lastSyncedAt}
        isSyncing={vault.isSyncActivityVisible}
        successMsg={vault.successMsg}
        errorMsg={vault.errorMsg}
        {appVersion}
        label="Nook"
        showSyncStatus={false}
        showStorageIcon={false}
        variant="quiet"
        onDismissSuccess={() => vault.dismissSuccess()}
        onDismissError={() => vault.dismissError()}
      />
    {/if}
    {#if showPasskeyOverlay}
      <PasskeyAuthOverlay {vault} onDismiss={onDismissPasskey} />
    {/if}
  {/if}
</div>
