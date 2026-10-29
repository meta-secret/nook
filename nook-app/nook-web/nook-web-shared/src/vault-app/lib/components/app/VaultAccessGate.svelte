<script lang="ts">
  import type { PairedIdentityUnlockTarget } from '$lib/app/extension-identity-adoption'
  import type { SentinelActionResult } from '$lib/vault/sentinel-genesis'
  type EnrollmentCodeUnlock = {
    readonly code: string
    readonly password: string
  }

  type VaultPasswordUnlock = {
    readonly entryId: string
    readonly password: string
  }

  import {
    configured_vault_application,
    type StartSentinelGenesisArgs,
  } from '$app-wasm'
  import { onDestroy, untrack } from 'svelte'
  import LoginGate from '$lib/components/LoginGate.svelte'
  import {
    ExtensionConnectIntentKind,
    type ExtensionConnectIntent,
  } from '$lib/app/route-state'
  import PasskeyAuthOverlay from '$lib/components/PasskeyAuthOverlay.svelte'
  import FirstRunProtectStep from '$lib/components/login/FirstRunProtectStep.svelte'
  import FirstRunSyncStep from '$lib/components/login/FirstRunSyncStep.svelte'
  import FirstRunNameStep from '$lib/components/login/FirstRunNameStep.svelte'
  import FirstRunVaultStep from '$lib/components/login/FirstRunVaultStep.svelte'
  import FirstRunJoinStep from '$lib/components/login/FirstRunJoinStep.svelte'
  import UnlockedIdentityPages from '$lib/components/identity-control/UnlockedIdentityPages.svelte'
  import { IdentityPages } from '$lib/vault/identity-pages'
  import { FirstRunStage, WorkspaceSection } from '$lib/vault/state/ui.svelte'
  import VaultStatusBar from '$lib/components/VaultStatusBar.svelte'
  import { VaultStatusBarVariant } from '$lib/components/vault-status-bar-state'
  import type { VaultState } from '$lib/vault.svelte'
  import type { NookIdentityHealth } from '$app-wasm'
  import type { ProviderSetupRequest } from '$lib/auth/providers'
  import type { LoginVaultExtensionPairingStatusEntry } from '$lib/components/login/login-vault-extension-pairing-status'

  const APP_KIND = configured_vault_application()

  function beginProviderSetup(request: ProviderSetupRequest): void {
    vault.beginProviderSetup(request)
  }

  async function removeProvider(id: string): Promise<void> {
    const removed = await vault.removeProvider(id)
    if (removed.isErr()) vault.errorMsg = vault.t(removed.error.translationKey)
  }

  let {
    vault,
    showAccessGate,
    existingVaultNeedsDeviceUnlock,
    identityKeyInExtension,
    usesExtensionDeviceIdentity,
    showPasskeyOverlay,
    sentinelInvitationRequest,
    sentinelParticipantResponsePending,
    sentinelParticipantResponse,
    sentinelOnboardingPackage,
    onUnlock,
    onUnlockOnCard,
    onUnlockPairedIdentity,
    onUseEnrollmentCode,
    onAcceptSentinelOnboardingPackage,
    onUnlockWithPassword,
    onSentinelUnlocked,
    onCreateDeviceVault,
    extensionConnectPairingStatusEntries,
    onStartSentinelGenesis,
    onCreateSentinelParticipantKey,
    onCreateSentinelParticipantResponse,
    onDismissPasskey,
    identityHealth,
    extensionConnectRequest = { kind: ExtensionConnectIntentKind.Absent },
  }: {
    vault: VaultState
    showAccessGate: boolean
    existingVaultNeedsDeviceUnlock: boolean
    /** This page adopted its identity from the paired extension, which holds
     * its key: unlocking it goes there, not to a passkey on this browser. */
    identityKeyInExtension: boolean
    usesExtensionDeviceIdentity: boolean
    showPasskeyOverlay: boolean
    sentinelInvitationRequest: string
    sentinelParticipantResponsePending: boolean
    sentinelParticipantResponse: string
    sentinelOnboardingPackage: string
    onUnlock: (skipExtensionDiscovery?: boolean) => Promise<void>
    /** Unlock a vault from its identity card; its device key unlocks there. */
    onUnlockOnCard: () => Promise<void>
    /** Unlock only the identity whose key the paired extension holds. */
    onUnlockPairedIdentity: (
      target: PairedIdentityUnlockTarget,
    ) => Promise<void>
    onUseEnrollmentCode: (args: EnrollmentCodeUnlock) => Promise<void>
    onAcceptSentinelOnboardingPackage: (packageJson: string) => Promise<void>
    onUnlockWithPassword: (args: VaultPasswordUnlock) => Promise<void>
    onSentinelUnlocked: () => Promise<void>
    onCreateDeviceVault: (label: string) => Promise<void>
    extensionConnectPairingStatusEntries: LoginVaultExtensionPairingStatusEntry[]
    onStartSentinelGenesis: (args: StartSentinelGenesisArgs) => Promise<boolean>
    onCreateSentinelParticipantKey: () => Promise<SentinelActionResult<string>>
    onCreateSentinelParticipantResponse: (
      requestPayload: string,
    ) => Promise<SentinelActionResult<string>>
    onDismissPasskey: () => void
    /** How the identity is protected; its unlocked card offers the
     * checklist here too, before any vault is open. */
    identityHealth?: NookIdentityHealth
    /** A browser extension asking to connect while this browser is locked. */
    extensionConnectRequest?: ExtensionConnectIntent
  } = $props()

  const appVersion = '0.1.0'

  function sentinelInvitationOpen(): boolean {
    return sentinelInvitationRequest.trim().length > 0
  }

  /** A first vault waiting for its passkey shows the guided step in place. */
  const firstRunProtect = $derived(
    showPasskeyOverlay && vault.firstRun === FirstRunStage.Protect,
  )

  function leaveFirstRunProtect(): void {
    vault.firstRun = FirstRunStage.Off
    onDismissPasskey()
  }

  /** Setup past the passkey and before its identity is settled: no vault is
   * open, so its steps show here. */
  const firstRunSetup = $derived(
    !vault.isAuthenticated &&
      (vault.firstRun === FirstRunStage.Sync ||
        vault.firstRun === FirstRunStage.Name ||
        vault.firstRun === FirstRunStage.Vault ||
        vault.firstRun === FirstRunStage.Joining),
  )

  /** An identity unlocked without a vault opened one of its pages. */
  const identityPages = new IdentityPages(untrack(() => vault))

  function identityTransitionPending(): boolean {
    return vault.identityTransitionPending
  }

  onDestroy(() => {
    if (vault.isAuthenticated) {
      vault.identityTransitionPending = false
      vault.identityPage = WorkspaceSection.Identities
    }
  })
</script>

<div class="space-y-6">
  {#if showAccessGate || vault.errorMsg || sentinelInvitationOpen() || identityTransitionPending()}
    {#if firstRunProtect}
      <FirstRunProtectStep {vault} onBack={leaveFirstRunProtect} />
    {:else if firstRunSetup}
      {#if vault.firstRun === FirstRunStage.Sync}
        <FirstRunSyncStep {vault} />
      {:else if vault.firstRun === FirstRunStage.Name}
        <FirstRunNameStep {vault} />
      {:else if vault.firstRun === FirstRunStage.Vault}
        <FirstRunVaultStep {vault} />
      {:else}
        <FirstRunJoinStep {vault} />
      {/if}
    {:else if identityPages.pageShown}
      <UnlockedIdentityPages {vault} />
    {:else if vault.providersLoaded || existingVaultNeedsDeviceUnlock || sentinelInvitationOpen() || identityTransitionPending() || (vault.hasManager && !vault.isInitializing)}
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
        {identityKeyInExtension}
        {usesExtensionDeviceIdentity}
        {onUnlock}
        {onUnlockOnCard}
        {onUnlockPairedIdentity}
        {...identityHealth ? { identityHealth } : {}}
        onBeginAddProvider={() => vault.beginAddProvider()}
        onCancelAddProvider={() => vault.cancelAddProvider()}
        onBeginSetup={beginProviderSetup}
        onCancelSetup={() => vault.cancelProviderSetup()}
        {onUseEnrollmentCode}
        prefillEnrollmentCode={vault.prefillEnrollmentCode}
        enrollmentFromUrlPending={vault.enrollmentFromUrlPending}
        {sentinelInvitationRequest}
        {sentinelParticipantResponsePending}
        {sentinelParticipantResponse}
        {sentinelOnboardingPackage}
        {onAcceptSentinelOnboardingPackage}
        {onUnlockWithPassword}
        {onSentinelUnlocked}
        {onCreateDeviceVault}
        {extensionConnectPairingStatusEntries}
        {extensionConnectRequest}
        {onStartSentinelGenesis}
        onCreateSentinelGenesisPublicKeyAnnouncement={onCreateSentinelParticipantKey}
        onCreateSentinelGenesisParticipantResponse={onCreateSentinelParticipantResponse}
        onRemoveProvider={removeProvider}
      />
    {/if}
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
    {#if showPasskeyOverlay && !firstRunProtect}
      <PasskeyAuthOverlay {vault} onDismiss={onDismissPasskey} />
    {/if}
  {/if}
</div>
