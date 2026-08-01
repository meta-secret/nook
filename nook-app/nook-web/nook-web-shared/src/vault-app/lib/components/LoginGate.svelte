<script lang="ts">
  import { I18N_KEYS } from '../../../generated/i18n-keys'
  import { KeyRound, RefreshCw, ShieldCheck } from '@lucide/svelte'
  import { onMount, tick, untrack } from 'svelte'
  import type { VaultState } from '$lib/vault.svelte'
  import {
    type DevicesAccessHostMount,
    DevicesAccessHostMountKind,
    DevicesAccessNudgePreference,
    DevicesAccessTriggerKind,
    parseDevicesAccessNudgePreference,
    readDevicesAccessNudgeStorage,
    shouldShowDevicesAccessNudge,
  } from './devices-access-dashboard-state'
  import {
    SentinelVaultUnlockState,
    type StartSentinelGenesisArgs,
  } from '$app-wasm'
  import { Button } from '$lib/components/ui/button'
  import type {
    OAuthFilePreset,
    StorageProvider,
    StorageProviderType,
  } from '$lib/auth/providers'
  import {
    DEFAULT_GITHUB_REPO,
    localFolderHandle,
    LocalFolderHandleKind,
    oauthAccessToken,
    OAuthAccessTokenKind,
  } from '$lib/auth/providers'
  import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
  } from '$lib/components/ui/card'
  import ProductIntro from '$lib/components/ProductIntro.svelte'
  import DevicesAccessDashboard from '$lib/components/DevicesAccessDashboard.svelte'
  import ProviderSetupFields from '$lib/components/ProviderSetupFields.svelte'
  import OAuthProviderSetupWizard from '$lib/components/OAuthProviderSetupWizard.svelte'
  import GitHubProviderSetupWizard from '$lib/components/GitHubProviderSetupWizard.svelte'
  import LocalFolderProviderSetupWizard from '$lib/components/LocalFolderProviderSetupWizard.svelte'
  import LoginUnlockStep from '$lib/components/login/LoginUnlockStep.svelte'
  import {
    LoginVaultEntryKind,
    type LoginVaultEntry,
  } from '$lib/components/login/login-unlock-state'
  import LoginCreateVaultChooser from '$lib/components/login/LoginCreateVaultChooser.svelte'
  import LoginVaultPicker from '$lib/components/login/LoginVaultPicker.svelte'
  import LoginProviderManagement from '$lib/components/login/LoginProviderManagement.svelte'
  import { LoginProviderManagementVariant } from '$lib/components/login/login-provider-management-state'
  import LoginEnrollmentPanel from '$lib/components/login/LoginEnrollmentPanel.svelte'
  import EnrollmentQrOnboardCard from '$lib/components/login/EnrollmentQrOnboardCard.svelte'
  import SentinelCeremonyPanel from '$lib/components/login/SentinelCeremonyPanel.svelte'
  import RemoteVaultRecoveryPanel from '$lib/components/login/RemoteVaultRecoveryPanel.svelte'
  import * as sentinelGenesisActions from '$lib/vault/sentinel-genesis'
  import {
    peekEnrollmentEntryId,
    peekEnrollmentEntryLabel,
    NookEnrollmentEntryLabelState,
    SentinelGenesisPhase,
    type VaultApplication,
  } from '$app-wasm'
  import {
    ActiveVaultKind,
    LocalFolderDraftKind,
    LoginSetupKind,
    LoginVaultSelectionKind,
    OAuthFileDraftKind,
    OAuthSetupPresetKind,
    RecoveryDiscoveryKind,
    type LoginSetup,
  } from '$lib/vault/state/provider.svelte'

  let {
    vault,
    appKind,
    providers,
    loginSetup,
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
    onSwitchVault,
    onSentinelUnlocked,
    onCreateDeviceVault,
    onStartSentinelGenesis,
    onCreateSentinelGenesisPublicKeyAnnouncement,
    onCreateSentinelGenesisParticipantResponse,
    onRemoveProvider,
    prefillEnrollmentCode = '',
    enrollmentFromUrlPending = false,
    deviceAuthorizationPending = false,
    usesExtensionDeviceIdentity = false,
    sentinelInvitationRequest = '',
    sentinelParticipantResponse = '',
    sentinelOnboardingPackage = '',
    onAcceptSentinelOnboardingPackage,
  }: {
    vault: VaultState
    appKind: VaultApplication
    providers: StorageProvider[]
    loginSetup: LoginSetup
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
    onUnlockWithPassword: (
      entryId: string,
      password: string,
    ) => void | Promise<void>
    onSwitchVault: () => void | Promise<void>
    onSentinelUnlocked?: () => void | Promise<void>
    onCreateDeviceVault: (label: string) => void | Promise<void>
    onStartSentinelGenesis: (args: StartSentinelGenesisArgs) => Promise<boolean>
    onCreateSentinelGenesisPublicKeyAnnouncement?: () =>
      | string
      | Promise<string>
    onCreateSentinelGenesisParticipantResponse?: (
      requestPayload: string,
    ) => string | Promise<string>
    onRemoveProvider?: (id: string) => void | Promise<void>
    prefillEnrollmentCode?: string
    enrollmentFromUrlPending?: boolean
    deviceAuthorizationPending?: boolean
    usesExtensionDeviceIdentity?: boolean
    sentinelInvitationRequest?: string
    sentinelParticipantResponse?: string
    sentinelOnboardingPackage?: string
    onAcceptSentinelOnboardingPackage?: (
      packageJson: string,
    ) => void | Promise<void>
  } = $props()

  let enrollmentPanelOpen = $state(false)
  let showProviderSetupLink = $state(false)
  let devicesAccessOpen = $state(false)
  let devicesAccessTrigger = $state(DevicesAccessTriggerKind.Header)
  let devicesAccessHost = $state<DevicesAccessHostMount>({
    kind: DevicesAccessHostMountKind.Unmounted,
  })
  let devicesAccessNudgePreference = $state(
    DevicesAccessNudgePreference.Visible,
  )
  const devicesAccessNudgeStorageKey = 'nook.devices-access.nudge-dismissed.v1'

  function dismissDevicesAccessNudge(): void {
    focusHostButton('login-devices-access')
    devicesAccessNudgePreference = DevicesAccessNudgePreference.Dismissed
    try {
      localStorage.setItem(
        devicesAccessNudgeStorageKey,
        DevicesAccessNudgePreference.Dismissed,
      )
    } catch {
      // Browser preference only. Private browsing may reject local storage.
    }
  }

  function captureDevicesAccessHost(element: HTMLDivElement) {
    devicesAccessHost = {
      kind: DevicesAccessHostMountKind.Mounted,
      element,
    }
    return {
      destroy() {
        devicesAccessHost = { kind: DevicesAccessHostMountKind.Unmounted }
      },
    }
  }

  function focusHostButton(testId: string): void {
    if (devicesAccessHost.kind === DevicesAccessHostMountKind.Unmounted) return
    devicesAccessHost.element
      .querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)
      ?.focus()
  }

  async function openDevicesAccess(
    trigger: DevicesAccessTriggerKind,
  ): Promise<void> {
    devicesAccessTrigger = trigger
    devicesAccessOpen = true
    await tick()
    focusHostButton('devices-access-back')
  }

  async function closeDevicesAccess(): Promise<void> {
    devicesAccessOpen = false
    await tick()
    const testId =
      devicesAccessTrigger === DevicesAccessTriggerKind.Nudge
        ? 'devices-access-nudge-review'
        : 'login-devices-access'
    focusHostButton(testId)
  }

  onMount(() => {
    try {
      devicesAccessNudgePreference = parseDevicesAccessNudgePreference(
        readDevicesAccessNudgeStorage(
          localStorage,
          devicesAccessNudgeStorageKey,
        ),
      )
    } catch {
      devicesAccessNudgePreference = DevicesAccessNudgePreference.Visible
    }
  })

  const prefillEnrollmentEntryLabel = $derived.by(() => {
    if (!prefillEnrollmentCode) return ''
    const label = peekEnrollmentEntryLabel(prefillEnrollmentCode)
    try {
      return label.state === NookEnrollmentEntryLabelState.Labeled
        ? label.value
        : ''
    } finally {
      label.free()
    }
  })

  const hasProviders = $derived(providers.length > 0)
  const showSetup = $derived(loginSetup.kind === LoginSetupKind.Active)
  function setupIs(type: StorageProviderType): boolean {
    return (
      loginSetup.kind === LoginSetupKind.Active &&
      loginSetup.providerType === type
    )
  }
  const showVaultPicker = $derived(
    vault.showLoginVaultPicker && !showProviderSetupLink,
  )
  const showSentinelCeremony = $derived(
    !vault.isAuthenticated &&
      (vault.sentinelCeremonyPrompt ||
        vault.sentinelUnlockStatus ===
          SentinelVaultUnlockState.CeremonyRequired ||
        vault.sentinelUnlockStatus === SentinelVaultUnlockState.AwaitingShares),
  )
  const showLocalUnlock = $derived(
    vault.localVaultPresent &&
      vault.sentinelGenesisPhase !== SentinelGenesisPhase.DeliveringShares &&
      !showSetup &&
      !addProviderOpen &&
      !showProviderSetupLink &&
      !showVaultPicker,
  )
  const activeLoginVault = $derived.by((): LoginVaultEntry => {
    const selectedStoreId =
      vault.selectedLoginVault.kind === LoginVaultSelectionKind.Selected
        ? vault.selectedLoginVault.storeId
        : vault.activeVault.kind === ActiveVaultKind.Open
          ? vault.activeVault.storeId
          : ''
    for (const entry of vault.localVaults) {
      if (entry.storeId === selectedStoreId) {
        return { kind: LoginVaultEntryKind.Available, entry }
      }
    }
    for (const entry of vault.localVaults) {
      return { kind: LoginVaultEntryKind.Available, entry }
    }
    return { kind: LoginVaultEntryKind.Unavailable }
  })
  const showQrOnboarding = $derived(
    Boolean(
      enrollmentFromUrlPending && prefillEnrollmentCode && onUseEnrollmentCode,
    ),
  )
  const showCreateVault = $derived(
    (vault.sentinelGenesisPhase === SentinelGenesisPhase.DeliveringShares ||
      (!vault.localVaultPresent &&
        vault.localVaults.length === 0 &&
        !hasProviders)) &&
      !showQrOnboarding &&
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
  const showEnrollmentAccess = $derived(
    Boolean(onUseEnrollmentCode) &&
      !showQrOnboarding &&
      (showProviderSetup || showSetup),
  )

  const setupCanConnect = $derived(
    setupIs('local') ||
      (setupIs('local-folder') &&
        vault.localFolderDraft.kind === LocalFolderDraftKind.Configured &&
        localFolderHandle(vault.localFolderDraft.config).kind ===
          LocalFolderHandleKind.Selected) ||
      (setupIs('oauth-file') &&
        vault.oauthFileDraft.kind === OAuthFileDraftKind.Configured &&
        oauthAccessToken(vault.oauthFileDraft.config).kind ===
          OAuthAccessTokenKind.Available) ||
      (setupIs('github') && Boolean(githubPat.trim())),
  )
  const recoveryPasswordEntries = $derived(
    vault.recoveryDiscovery.kind === RecoveryDiscoveryKind.Found
      ? vault.recoveryDiscovery.summary.passwordEntries
      : [],
  )
  const oauthPreset = $derived(
    vault.oauthFileDraft.kind === OAuthFileDraftKind.Configured
      ? vault.oauthFileDraft.config.preset
      : vault.oauthSetupSelection.kind === OAuthSetupPresetKind.Selected
        ? vault.oauthSetupSelection.preset
        : 'google-drive',
  )

  function handleFirstConnectSubmit(e: Event) {
    e.preventDefault()
    void onUnlock()
  }

  $effect(() => {
    if (
      vault.sentinelGenesisPhase === SentinelGenesisPhase.DeliveringShares &&
      vault.syncProviders.length > 0 &&
      !showSetup &&
      !addProviderOpen
    ) {
      showProviderSetupLink = false
    }
    if (showLocalUnlock) {
      untrack(() => void vault.prepareLocalLogin())
    }
    if (
      !deviceAuthorizationPending &&
      !vault.isAuthenticated &&
      (vault.syncProviders.length > 0 || vault.localVaultPresent)
    ) {
      untrack(() => void vault.refreshSentinelUnlockStatus())
    }
  })
</script>

<div
  use:captureDevicesAccessHost
  class="w-full space-y-3 animate-in fade-in duration-300"
  data-testid="login-gate"
  data-local-vault={vault.localVaultPresent ? 'true' : 'false'}
>
  {#if devicesAccessOpen}
    <DevicesAccessDashboard
      {vault}
      onBack={() => void closeDevicesAccess()}
      onManageVaultDevices={() => {}}
      onManageVaultPasswords={() => {}}
    />
  {:else}
    <div class="flex justify-end">
      <Button
        type="button"
        variant="ghost"
        class="min-h-11 gap-2 text-muted-foreground hover:text-foreground"
        data-testid="login-devices-access"
        onclick={() => void openDevicesAccess(DevicesAccessTriggerKind.Header)}
      >
        <KeyRound class="size-4" />
        {vault.t(I18N_KEYS.DevicesAccessTitle)}
      </Button>
    </div>

    {#if shouldShowDevicesAccessNudge(
      vault.localVaultPresent,
      vault.localVaults.length,
      devicesAccessNudgePreference,
    )}
      <aside
        class="flex flex-col gap-3 rounded-xl border border-primary/20 bg-primary/8 p-4 sm:flex-row sm:items-center sm:justify-between"
        data-testid="devices-access-nudge"
      >
        <div class="max-w-[65ch]">
          <p class="text-sm font-medium text-foreground">
            {vault.t(I18N_KEYS.DevicesAccessNudgeTitle)}
          </p>
          <p class="mt-1 text-sm text-muted-foreground">
            {vault.t(I18N_KEYS.DevicesAccessNudgeDescription)}
          </p>
        </div>
        <div class="flex shrink-0 flex-col items-start gap-2 sm:items-end">
          <Button
            type="button"
            variant="outline"
            class="min-h-11"
            data-testid="devices-access-nudge-review"
            onclick={() => void openDevicesAccess(DevicesAccessTriggerKind.Nudge)}
          >
            {vault.t(I18N_KEYS.DevicesAccessReviewAction)}
          </Button>
          <label class="flex min-h-7 cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              class="size-4 rounded border-input accent-primary"
              data-testid="devices-access-dont-show-again"
              onchange={(event) => {
                if (event.currentTarget.checked) dismissDevicesAccessNudge()
              }}
            />
            {vault.t(I18N_KEYS.DevicesAccessDontShowAgain)}
          </label>
        </div>
      </aside>
    {/if}

  {#if vault.sessionExpiredByIdle}
    <p
      class="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-100"
      data-testid="login-session-expired"
      role="status"
    >
      {vault.t(I18N_KEYS.SessionExpiredIdle)}
    </p>
  {/if}

  {#if showQrOnboarding}
    <EnrollmentQrOnboardCard
      {vault}
      code={prefillEnrollmentCode}
      passwordEntryId={peekEnrollmentEntryId(prefillEnrollmentCode)}
      passwordEntryLabel={prefillEnrollmentEntryLabel}
      {isVerifying}
      onSubmit={(password) =>
        onUseEnrollmentCode!(prefillEnrollmentCode, password)}
    />
  {:else if showCreateVault || sentinelInvitationRequest.trim()}
    <LoginCreateVaultChooser
      {vault}
      {appKind}
      {isVerifying}
      {isInitializing}
      {usesExtensionDeviceIdentity}
      {onCreateDeviceVault}
      {onStartSentinelGenesis}
      onAddSentinelGenesisParticipantResponse={(payload, participantLabel) =>
        sentinelGenesisActions.addParticipantResponse(
          vault,
          payload,
          participantLabel,
        )}
      onFinalizeSentinelGenesis={() => sentinelGenesisActions.finalize(vault)}
      onCreateSentinelGenesisParticipantResponse={onCreateSentinelGenesisParticipantResponse ??
        ((payload) =>
          sentinelGenesisActions.createParticipantResponse(vault, payload))}
      onCreateSentinelGenesisPublicKeyAnnouncement={onCreateSentinelGenesisPublicKeyAnnouncement ??
        (() => sentinelGenesisActions.createPublicKeyAnnouncement(vault))}
      onRememberSentinelGenesisRequest={(payload) =>
        sentinelGenesisActions.rememberRequest(vault, payload)}
      onReceiveSentinelGenesisShare={(payload) =>
        sentinelGenesisActions.acceptShareDelivery(vault, payload)}
      onCompleteSentinelGenesisDelivery={() =>
        sentinelGenesisActions.completeDelivery(vault)}
      sentinelGenesisPhase={vault.sentinelGenesisPhase}
      sentinelGenesisRequest={vault.sentinelGenesisRequest}
      sentinelGenesisParticipants={vault.sentinelGenesisParticipants}
      sentinelGenesisDeliveries={vault.sentinelGenesisDeliveries}
      {sentinelInvitationRequest}
      {sentinelParticipantResponse}
      {sentinelOnboardingPackage}
      {onAcceptSentinelOnboardingPackage}
      onConnectStorage={() => {
        vault.beginExistingVaultOpen()
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
        {vault.t(I18N_KEYS.LoginVaultPickerHint)}
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
              {vault.t(I18N_KEYS.LoginVaultPickerTitle)}
            {:else if showLocalUnlock}
              {vault.t(I18N_KEYS.LoginOpenVaultTitle)}
            {:else if showSetup}
              {vault.t(I18N_KEYS.OnboardingConnectTo, {
                provider: setupIs('github')
                  ? 'GitHub'
                  : setupIs('local-folder')
                    ? vault.t(I18N_KEYS.ProviderPickerLocalFolder)
                    : vault.t(I18N_KEYS.OnboardingLocalStorage),
              })}
            {:else if addProviderOpen}
              {vault.t(I18N_KEYS.OnboardingAddProvider)}
            {:else}
              {vault.t(I18N_KEYS.OnboardingSetupStorage)}
            {/if}
          </CardTitle>
          {#if isUnlocking}
            <CardDescription class="text-pretty"
              >{vault.t(I18N_KEYS.LoginUnlocking)}</CardDescription
            >
          {:else if showVaultPicker}
            <CardDescription class="text-pretty">
              {vault.t(I18N_KEYS.LoginVaultPickerSubtitle)}
            </CardDescription>
          {:else if showLocalUnlock}
            <CardDescription class="text-pretty">
              {vault.t(I18N_KEYS.LoginOpenVaultSubtitle)}
            </CardDescription>
          {:else if showSetup && setupIs('github')}
            <CardDescription class="text-pretty">
              {vault.t(I18N_KEYS.OnboardingGithubDescription)}
            </CardDescription>
          {:else if showSetup}
            <CardDescription class="text-pretty">
              {vault.t(I18N_KEYS.OnboardingLocalDescription)}
            </CardDescription>
          {:else if addProviderOpen}
            <CardDescription class="text-pretty">
              {vault.t(I18N_KEYS.OnboardingAnotherProvider)}
            </CardDescription>
          {/if}
        </div>
      </CardHeader>

      <CardContent class="px-6 pb-5 pt-4 sm:pb-6">
        {#if showSentinelCeremony && !showVaultPicker}
          <SentinelCeremonyPanel
            {vault}
            {isVerifying}
            {isInitializing}
            onUnlocked={onSentinelUnlocked}
          />
        {:else if showVaultPicker && onCreateDeviceVault}
          <LoginVaultPicker
            {vault}
            vaults={vault.localVaults}
            {isVerifying}
            {isInitializing}
            onChooseVault={(storeId) => vault.chooseLoginVault(storeId)}
            onCreateVault={onCreateDeviceVault}
            onConnectStorage={() => {
              vault.beginExistingVaultOpen()
              showProviderSetupLink = true
            }}
          />
        {:else if showLocalUnlock}
          <LoginUnlockStep
            {vault}
            vaultEntry={activeLoginVault}
            hasMultipleVaults={vault.hasMultipleLocalVaults}
            passwordEntries={vault.passwordEntries.length > 0
              ? vault.passwordEntries
              : recoveryPasswordEntries}
            selectedPasswordEntry={vault.selectedPasswordEntry}
            onSelectPasswordEntry={(selection) => {
              vault.selectedPasswordEntry = selection
            }}
            {isVerifying}
            {isInitializing}
            {isUnlocking}
            {onUnlock}
            {onUnlockWithPassword}
            {onSwitchVault}
            onCreateAnotherVault={onCreateDeviceVault}
            onImportFromSync={() => {
              vault.beginExistingVaultOpen()
              showProviderSetupLink = true
            }}
          />
          <p class="mt-4 text-center text-xs text-muted-foreground">
            {vault.t(I18N_KEYS.LoginSyncAfterUnlock)}
          </p>
        {:else if showSetup}
          {#if setupIs('oauth-file')}
            <OAuthProviderSetupWizard
              {vault}
              bind:githubRepo
              idPrefix="login"
              preset={oauthPreset}
              {isVerifying}
              {isInitializing}
              {onCancelSetup}
              onConnect={onUnlock}
            />
          {:else if setupIs('github')}
            <GitHubProviderSetupWizard
              {vault}
              bind:githubPat
              bind:githubRepo
              idPrefix="login"
              {isVerifying}
              {isInitializing}
              connectDisabled={vault.clientPolicy.remoteRecoveryPromptVisible(
                vault.remoteVaultRecoveryState,
              )}
              {onCancelSetup}
              onConnect={onUnlock}
            >
              {#snippet beforeConnect()}
                {#if vault.clientPolicy.remoteRecoveryPromptVisible(vault.remoteVaultRecoveryState)}
                  <RemoteVaultRecoveryPanel
                    {vault}
                    state={vault.remoteVaultRecoveryState}
                    isBusy={isVerifying}
                    onRecover={() => vault.confirmRecoverRemoteVault()}
                    onCreateFresh={() => vault.confirmCreateFreshRemoteVault()}
                    onDismiss={() => vault.clearRemoteVaultRecovery()}
                  />
                {/if}
              {/snippet}
            </GitHubProviderSetupWizard>
          {:else if setupIs('local-folder')}
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
                    {vault.t(I18N_KEYS.OnboardingLoadingEngine)}
                  {:else if isVerifying}
                    <RefreshCw class="size-4 animate-spin" />
                    {vault.t(I18N_KEYS.CommonConnecting)}
                  {:else}
                    <ShieldCheck class="size-4" />
                    {vault.t(I18N_KEYS.CommonConnect)}
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
                vault.cancelExistingVaultOpen()
                showProviderSetupLink = false
              }}
            >
              {vault.t(I18N_KEYS.LoginBackToGetStarted)}
            </button>
          {/if}
          <LoginProviderManagement
            {vault}
            variant={LoginProviderManagementVariant.Setup}
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
  {/if}
</div>
