<script lang="ts">
  import { RefreshCw, ShieldCheck } from '@lucide/svelte'
  import type { StartSentinelGenesisArgs, VaultState } from '$lib/vault.svelte'
  import { Button } from '$lib/components/ui/button'
  import type {
    OAuthFilePreset,
    StorageProvider,
    StorageProviderType,
  } from '$lib/auth-providers'
  import { DEFAULT_GITHUB_REPO } from '$lib/auth-providers'
  import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
  } from '$lib/components/ui/card'
  import ProductIntro from '$lib/components/ProductIntro.svelte'
  import ProviderSetupFields from '$lib/components/ProviderSetupFields.svelte'
  import OAuthProviderSetupWizard from '$lib/components/OAuthProviderSetupWizard.svelte'
  import GitHubProviderSetupWizard from '$lib/components/GitHubProviderSetupWizard.svelte'
  import LocalFolderProviderSetupWizard from '$lib/components/LocalFolderProviderSetupWizard.svelte'
  import LoginUnlockStep from '$lib/components/login/LoginUnlockStep.svelte'
  import LoginCreateVaultChooser from '$lib/components/login/LoginCreateVaultChooser.svelte'
  import LoginVaultPicker from '$lib/components/login/LoginVaultPicker.svelte'
  import LoginProviderManagement from '$lib/components/login/LoginProviderManagement.svelte'
  import LoginEnrollmentPanel from '$lib/components/login/LoginEnrollmentPanel.svelte'
  import EnrollmentQrOnboardCard from '$lib/components/login/EnrollmentQrOnboardCard.svelte'
  import SentinelCeremonyPanel from '$lib/components/login/SentinelCeremonyPanel.svelte'
  import RemoteVaultRecoveryPanel from '$lib/components/login/RemoteVaultRecoveryPanel.svelte'
  import {
    peekEnrollmentEntryId,
    peekEnrollmentEntryLabel,
  } from '$lib/nook-wasm/nook_wasm'

  let {
    vault,
    providers,
    setupType = $bindable(undefined as StorageProviderType | undefined),
    githubPat = $bindable(''),
    githubRepo = $bindable(DEFAULT_GITHUB_REPO),
    isVerifying,
    isInitializing,
    addProviderOpen = false,
    onUnlock,
    onBeginAddProvider,
    onCancelAddProvider,
    onBeginSetup,
    onCancelSetup,
    onOpenHelp,
    onUseEnrollmentCode,
    onUnlockWithPassword,
    onCreateDeviceVault,
    onStartSentinelGenesis,
    onCreateSentinelGenesisPublicKeyAnnouncement,
    onRemoveProvider,
    prefillEnrollmentCode = '',
    enrollmentFromUrlPending = false,
    deviceAuthorizationPending = false,
    sentinelInvitationRequest = '',
  }: {
    vault: VaultState
    providers: StorageProvider[]
    setupType?: StorageProviderType | undefined
    githubPat: string
    githubRepo: string
    isVerifying: boolean
    isInitializing: boolean
    addProviderOpen?: boolean
    onUnlock: () => void | Promise<void>
    onBeginAddProvider?: () => void
    onCancelAddProvider?: () => void
    onBeginSetup: (
      type: StorageProviderType,
      oauthPreset?: OAuthFilePreset,
    ) => void
    onCancelSetup: () => void
    onOpenHelp?: () => void
    onUseEnrollmentCode?: (
      code: string,
      password: string,
    ) => void | Promise<void>
    onUnlockWithPassword?: (
      entryId: string,
      password: string,
    ) => void | Promise<void>
    onCreateDeviceVault?: (label: string) => void | Promise<void>
    onStartSentinelGenesis?: (
      args: StartSentinelGenesisArgs,
    ) => boolean | void | Promise<boolean | void>
    onCreateSentinelGenesisPublicKeyAnnouncement?: () =>
      | string
      | Promise<string>
    onRemoveProvider?: (id: string) => void | Promise<void>
    prefillEnrollmentCode?: string
    enrollmentFromUrlPending?: boolean
    deviceAuthorizationPending?: boolean
    sentinelInvitationRequest?: string
  } = $props()

  let enrollmentPanelOpen = $state(false)
  let showProviderSetupLink = $state(false)

  const hasProviders = $derived(providers.length > 0)
  const showSetup = $derived(setupType !== undefined)
  const showVaultPicker = $derived(
    vault.showLoginVaultPicker && !showProviderSetupLink,
  )
  const showSentinelCeremony = $derived(
    !vault.isAuthenticated &&
      (vault.sentinelCeremonyPrompt ||
        vault.sentinelUnlockStatus === 'ceremony_required' ||
        vault.sentinelUnlockStatus === 'awaiting_shares'),
  )
  const showLocalUnlock = $derived(
    vault.localVaultPresent &&
      vault.sentinelGenesisStatus !== 'delivering' &&
      !showSetup &&
      !addProviderOpen &&
      !showProviderSetupLink &&
      !showVaultPicker,
  )
  const activeLoginVault = $derived(
    vault.localVaults.find(
      (entry) =>
        entry.storeId ===
        (vault.selectedLoginVaultStoreId ?? vault.activeVaultStoreId),
    ) ??
      vault.localVaults[0] ??
      undefined,
  )
  const showCreateVault = $derived(
    (!vault.localVaultPresent ||
      vault.sentinelGenesisStatus === 'delivering') &&
      vault.localVaults.length === 0 &&
      !hasProviders &&
      !showSetup &&
      !addProviderOpen &&
      !showProviderSetupLink &&
      !showVaultPicker,
  )
  const showProviderSetup = $derived(
    (showProviderSetupLink ||
      addProviderOpen ||
      (hasProviders && !vault.localVaultPresent)) &&
      !showSetup &&
      !showLocalUnlock &&
      !showCreateVault,
  )
  const isUnlocking = $derived(
    isVerifying && (showLocalUnlock || showSetup) && !showSetup,
  )
  const showQrOnboarding = $derived(
    Boolean(
      enrollmentFromUrlPending && prefillEnrollmentCode && onUseEnrollmentCode,
    ),
  )
  const showEnrollmentAccess = $derived(
    Boolean(onUseEnrollmentCode) &&
      !showQrOnboarding &&
      (showProviderSetup || showSetup),
  )

  const setupCanConnect = $derived(
    setupType === 'local' ||
      (setupType === 'local-folder' &&
        Boolean(vault.localFolder?.handleId?.trim())) ||
      (setupType === 'oauth-file' &&
        Boolean(vault.oauthFile?.accessToken?.trim())) ||
      (setupType === 'github' && Boolean(githubPat.trim())),
  )

  function handleFirstConnectSubmit(e: Event) {
    e.preventDefault()
    void onUnlock()
  }

  $effect(() => {
    if (showLocalUnlock && !deviceAuthorizationPending) {
      void vault.prepareLocalLogin()
    }
    if (
      !deviceAuthorizationPending &&
      !vault.isAuthenticated &&
      (vault.syncProviders.length > 0 || vault.localVaultPresent)
    ) {
      void vault.refreshSentinelUnlockStatus()
    }
  })
</script>

<div
  class="w-full space-y-3 animate-in fade-in duration-300"
  data-testid="login-gate"
  data-local-vault={vault.localVaultPresent ? 'true' : 'false'}
>
  {#if vault.sessionExpiredByIdle}
    <p
      class="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-100"
      data-testid="login-session-expired"
      role="status"
    >
      {vault.t('session.expired_idle')}
    </p>
  {/if}

  {#if showQrOnboarding}
    <EnrollmentQrOnboardCard
      {vault}
      code={prefillEnrollmentCode}
      passwordEntryId={peekEnrollmentEntryId(prefillEnrollmentCode)}
      passwordEntryLabel={peekEnrollmentEntryLabel(prefillEnrollmentCode)}
      {isVerifying}
      onSubmit={(password) =>
        onUseEnrollmentCode!(prefillEnrollmentCode, password)}
    />
  {:else if showCreateVault && onCreateDeviceVault}
    <LoginCreateVaultChooser
      {vault}
      {isVerifying}
      {isInitializing}
      {onCreateDeviceVault}
      onStartSentinelGenesis={onStartSentinelGenesis ??
        ((args) => vault.startSentinelGenesis(args))}
      onAddSentinelGenesisParticipantResponse={(payload) =>
        vault.addSentinelGenesisParticipantResponse(payload)}
      onFinalizeSentinelGenesis={() => vault.finalizeSentinelGenesis()}
      onCreateSentinelGenesisParticipantResponse={(payload) =>
        vault.createSentinelGenesisParticipantResponse(payload)}
      onCreateSentinelGenesisPublicKeyAnnouncement={onCreateSentinelGenesisPublicKeyAnnouncement ??
        (() => vault.createSentinelGenesisPublicKeyAnnouncement())}
      onRememberSentinelGenesisRequest={(payload) =>
        vault.rememberSentinelGenesisRequest(payload)}
      onReceiveSentinelGenesisShare={(payload) =>
        vault.acceptSentinelGenesisShareDelivery(payload)}
      onCompleteSentinelGenesisDelivery={() =>
        vault.completeSentinelGenesisDelivery()}
      sentinelGenesisStatus={vault.sentinelGenesisStatus}
      sentinelGenesisRequest={vault.sentinelGenesisRequest}
      sentinelGenesisParticipants={vault.sentinelGenesisParticipants}
      sentinelGenesisDeliveries={vault.sentinelGenesisDeliveries}
      {sentinelInvitationRequest}
      onConnectStorage={() => {
        showProviderSetupLink = true
      }}
    />

    {#if showEnrollmentAccess}
      <LoginEnrollmentPanel
        {vault}
        bind:open={enrollmentPanelOpen}
        {isVerifying}
        initialCode={prefillEnrollmentCode}
        openFormInitially={false}
        {onUseEnrollmentCode}
      />
    {/if}
  {:else}
    {#if !hasProviders && !showSetup && !showLocalUnlock && onOpenHelp}
      <ProductIntro {vault} {onOpenHelp} />
    {/if}

    {#if showLocalUnlock}
      <p
        class="text-xs text-muted-foreground"
        data-testid="login-local-vault-detected"
      >
        {vault.t('login.vault_picker_hint')}
      </p>
    {/if}

    <Card
      class="gap-0 border-border bg-card/80 py-0 shadow-lg shadow-black/20 backdrop-blur-sm overflow-hidden"
    >
      <CardHeader class="border-b border-border/60 px-6 pb-4 pt-5">
        <div class="space-y-1">
          <CardTitle
            class="text-lg font-semibold tracking-tight text-foreground"
          >
            {#if showVaultPicker}
              {vault.t('login.vault_picker_title')}
            {:else if showLocalUnlock}
              {vault.t('login.open_vault_title')}
            {:else if showSetup}
              {vault.t('onboarding.connect_to', {
                provider:
                  setupType === 'github'
                    ? 'GitHub'
                    : setupType === 'local-folder'
                      ? vault.t('provider_picker.local_folder')
                      : vault.t('onboarding.local_storage'),
              })}
            {:else if addProviderOpen}
              {vault.t('onboarding.add_provider')}
            {:else}
              {vault.t('onboarding.setup_storage')}
            {/if}
          </CardTitle>
          {#if isUnlocking}
            <CardDescription class="text-pretty"
              >{vault.t('login.unlocking')}</CardDescription
            >
          {:else if showVaultPicker}
            <CardDescription class="text-pretty">
              {vault.t('login.vault_picker_subtitle')}
            </CardDescription>
          {:else if showLocalUnlock}
            <CardDescription class="text-pretty">
              {vault.t('login.open_vault_subtitle')}
            </CardDescription>
          {:else if showSetup && setupType === 'github'}
            <CardDescription class="text-pretty">
              {vault.t('onboarding.github_description')}
            </CardDescription>
          {:else if showSetup}
            <CardDescription class="text-pretty">
              {vault.t('onboarding.local_description')}
            </CardDescription>
          {:else if addProviderOpen}
            <CardDescription class="text-pretty">
              {vault.t('onboarding.another_provider')}
            </CardDescription>
          {/if}
        </div>
      </CardHeader>

      <CardContent class="px-6 pb-5 pt-4 sm:pb-6">
        {#if showSentinelCeremony && !showVaultPicker}
          <SentinelCeremonyPanel {vault} {isVerifying} {isInitializing} />
        {:else if showVaultPicker && onCreateDeviceVault}
          <LoginVaultPicker
            {vault}
            vaults={vault.localVaults}
            {isVerifying}
            {isInitializing}
            onChooseVault={(storeId) => vault.chooseLoginVault(storeId)}
            onCreateVault={onCreateDeviceVault}
            onConnectStorage={() => {
              showProviderSetupLink = true
            }}
          />
        {:else if showLocalUnlock}
          <LoginUnlockStep
            {vault}
            vaultEntry={activeLoginVault}
            hasMultipleVaults={vault.hasMultipleLocalVaults}
            passwordEntries={vault.passwordEntries}
            bind:selectedPasswordEntryId={vault.selectedPasswordEntryId}
            {isVerifying}
            {isInitializing}
            {isUnlocking}
            {onUnlock}
            {onUnlockWithPassword}
            onSwitchVault={() => vault.beginLoginVaultPicker()}
            onCreateAnotherVault={onCreateDeviceVault}
            onImportFromSync={() => {
              showProviderSetupLink = true
            }}
          />
          <p class="mt-4 text-center text-xs text-muted-foreground">
            {vault.t('login.sync_after_unlock')}
          </p>
        {:else if showSetup && setupType}
          {#if setupType === 'oauth-file'}
            <OAuthProviderSetupWizard
              {vault}
              bind:githubRepo
              idPrefix="login"
              preset={vault.oauthFile?.preset ??
                vault.oauthSetupPreset ??
                'google-drive'}
              {isVerifying}
              {isInitializing}
              {onCancelSetup}
              onConnect={onUnlock}
            />
          {:else if setupType === 'github'}
            <GitHubProviderSetupWizard
              {vault}
              bind:githubPat
              bind:githubRepo
              idPrefix="login"
              {isVerifying}
              {isInitializing}
              connectDisabled={vault.remoteVaultRecoveryPrompt !== 'none'}
              {onCancelSetup}
              onConnect={onUnlock}
            >
              {#snippet beforeConnect()}
                {#if vault.remoteVaultRecoveryPrompt !== 'none'}
                  <RemoteVaultRecoveryPanel
                    {vault}
                    mode={vault.remoteVaultRecoveryPrompt}
                    isBusy={isVerifying}
                    onRecover={() => vault.confirmRecoverRemoteVault()}
                    onCreateFresh={() => vault.confirmCreateFreshRemoteVault()}
                    onDismiss={() => vault.clearRemoteVaultRecovery()}
                  />
                {/if}
              {/snippet}
            </GitHubProviderSetupWizard>
          {:else if setupType === 'local-folder'}
            <LocalFolderProviderSetupWizard
              {vault}
              idPrefix="login"
              {isVerifying}
              {isInitializing}
              {onCancelSetup}
              onConnect={onUnlock}
            />
          {:else}
            <form
              novalidate
              onsubmit={handleFirstConnectSubmit}
              class="space-y-4"
            >
              <ProviderSetupFields {vault} {onCancelSetup} />
              <div class="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button
                  type="submit"
                  class="sm:min-w-[180px]"
                  data-testid="connect-provider-btn"
                  disabled={!setupCanConnect}
                >
                  {#if isInitializing}
                    <RefreshCw class="size-4 animate-spin" />
                    {vault.t('onboarding.loading_engine')}
                  {:else if isVerifying}
                    <RefreshCw class="size-4 animate-spin" />
                    {vault.t('common.connecting')}
                  {:else}
                    <ShieldCheck class="size-4" />
                    {vault.t('common.connect')}
                  {/if}
                </Button>
              </div>
            </form>
          {/if}
        {:else if showProviderSetup}
          {#if showProviderSetupLink && !addProviderOpen}
            <button
              type="button"
              class="mb-3 text-sm font-medium text-primary underline-offset-4 hover:underline"
              data-testid="login-back-to-get-started"
              onclick={() => {
                showProviderSetupLink = false
              }}
            >
              {vault.t('login.back_to_get_started')}
            </button>
          {/if}
          <LoginProviderManagement
            {vault}
            variant="setup"
            {providers}
            {isVerifying}
            {isInitializing}
            addingProvider={addProviderOpen}
            {onBeginAddProvider}
            {onBeginSetup}
            {onCancelAddProvider}
            {onRemoveProvider}
          />
        {/if}
      </CardContent>
    </Card>

    {#if showEnrollmentAccess}
      <LoginEnrollmentPanel
        {vault}
        bind:open={enrollmentPanelOpen}
        {isVerifying}
        initialCode={prefillEnrollmentCode}
        openFormInitially={false}
        {onUseEnrollmentCode}
      />
    {/if}
  {/if}
</div>
