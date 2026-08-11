<script lang="ts">
  import { I18N_KEYS } from '../../../generated/i18n-keys'
  import {
    ChevronLeft,
    Cloud,
    HardDrive,
    Plus,
    QrCode,
    RefreshCw,
  } from '@lucide/svelte'
  import EnrollmentOnboardResult from '$lib/components/EnrollmentOnboardResult.svelte'
  import GitHubProviderSetupWizard from '$lib/components/GitHubProviderSetupWizard.svelte'
  import LocalFolderProviderSetupWizard from '$lib/components/LocalFolderProviderSetupWizard.svelte'
  import OAuthProviderSetupWizard from '$lib/components/OAuthProviderSetupWizard.svelte'
  import ProviderPicker from '$lib/components/ProviderPicker.svelte'
  import ProviderSetupFields from '$lib/components/ProviderSetupFields.svelte'
  import SetupWizardStep from '$lib/components/SetupWizardStep.svelte'
  import OnboardDevicePasswordStep from '$lib/components/onboard-device/OnboardDevicePasswordStep.svelte'
  import SentinelOnboardingGuidance from '$lib/components/onboard-device/SentinelOnboardingGuidance.svelte'
  import { Button } from '$lib/components/ui/button'
  import { buildEnrollmentLink, getEnrollmentLinkBase } from '$lib/enrollment/code'
  import {
    GITHUB_PROVIDER_TYPE,
    GOOGLE_DRIVE_OAUTH_FILE_PRESET,
    isICloudProvider,
    localizeProviderLabel,
    providerStorageDetail,
    type ProviderSetupRequest,
    type StorageProvider,
    type StorageProviderType,
  } from '$lib/auth/providers'
  import {
    peek_enrollment_issued_at,
    type NookPasswordEntrySummary,
    type PasswordEntryId,
  } from '$app-wasm'
  import type { VaultState } from '$lib/vault.svelte'
  import {
    LoginSetupKind,
    OAuthFileDraftKind,
    OAuthSetupPresetKind,
    type LoginSetup,
  } from '$lib/vault/state/provider.svelte'
  import { OnboardingType, VaultType } from '$lib/vault/architecture-model'
  import {
    CompatibleProviderSelectionKind,
    firstCompatibleProvider,
    vault_architecture_onboarding_type,
    providerCapabilityLabelKey,
    provider_onboarding_type,
    provider_supports_replication,
  } from '$lib/vault/architecture-model'
  import {
    PasswordEntrySelectionKind,
    ProviderSelectionKind,
    ResolvedOnboardingPasswordKind,
    ResolvedOnboardingProviderKind,
    type PasswordEntrySelection,
    type ProviderSelection,
    type ResolvedOnboardingPassword,
    type ResolvedOnboardingProvider,
  } from './onboard-device-state'

  let {
    vault,
    syncProviders,
    passwordEntries,
    enrollmentCode,
    isBusy,
    passwordError,
    isVerifying,
    isInitializing,
    addProviderOpen = false,
    loginSetup,
    githubPat = $bindable(''),
    githubRepo = $bindable(''),
    onIssueCode,
    onClearCode,
    onAddPassword,
    onBeginAddProvider,
    onCancelAddProvider,
    onBeginSetup,
    onCancelSetup,
    onConnectProvider,
  }: {
    vault: VaultState
    syncProviders: StorageProvider[]
    passwordEntries: NookPasswordEntrySummary[]
    enrollmentCode: string
    isBusy: boolean
    passwordError: string
    isVerifying: boolean
    isInitializing: boolean
    addProviderOpen?: boolean
    loginSetup: LoginSetup
    githubPat: string
    githubRepo: string
    onIssueCode: (
      args: { readonly entryId: PasswordEntryId; readonly password: string; readonly providerId: string },
    ) => Promise<string>
    onClearCode: () => void
    onAddPassword: (args: { readonly label: string; readonly password: string }) => void | Promise<void>
    onBeginAddProvider?: () => void
    onCancelAddProvider?: () => void
    onBeginSetup: (request: ProviderSetupRequest) => void
    onCancelSetup: () => void
    onConnectProvider: () => void | Promise<void>
  } = $props()

  const hasPasswords = $derived(passwordEntries.length > 0)
  const hasSyncProviders = $derived(syncProviders.length > 0)
  const compatibleSyncProviders = $derived(
    syncProviders.filter((provider) =>
      provider_supports_replication(
        provider,
        vault.vaultArchitecture.replication_type,
      ),
    ),
  )
  const hasCompatibleSyncProviders = $derived(
    compatibleSyncProviders.length > 0,
  )
  const showSetup = $derived(loginSetup.kind === LoginSetupKind.Active)
  function setupIs(type: StorageProviderType): boolean {
    return (
      loginSetup.kind === LoginSetupKind.Active &&
      loginSetup.providerType === type
    )
  }
  const addingProvider = $derived(addProviderOpen || showSetup)
  const oauthPreset = $derived(
    vault.oauthFileDraft.kind === OAuthFileDraftKind.Configured
      ? vault.oauthFileDraft.config.preset
      : vault.oauthSetupSelection.kind === OAuthSetupPresetKind.Selected
        ? vault.oauthSetupSelection.preset
        : GOOGLE_DRIVE_OAUTH_FILE_PRESET,
  )
  const isSentinelVault = $derived(
    vault.vaultArchitecture.vault_type === VaultType.Sentinel,
  )
  const sentinelReadyParticipants = $derived(
    vault.vaultArchitecture.sentinel_ready_participants ?? 0,
  )
  const sentinelRequiredParticipants = $derived(
    vault.vaultArchitecture.sentinel_required_participants ?? 0,
  )

  let selectedProviderIdState = $state<ProviderSelection>({
    kind: ProviderSelectionKind.Automatic,
  })
  let passwordEntry = $state<PasswordEntrySelection>({
    kind: PasswordEntrySelectionKind.NotSelected,
  })
  let passwordInput = $state('')
  let localError = $state('')
  let isGenerating = $state(false)

  let passwordStepOpen = $state(true)
  let syncStepOpen = $state(false)
  let generateStepOpen = $state(false)

  function onSelectPasswordEntry(entryId: PasswordEntryId): void {
    passwordEntry = {
      kind: PasswordEntrySelectionKind.Selected,
      entryId,
    }
    passwordInput = ''
  }

  const effectiveProviderId = $derived.by(() => {
    const firstCompatibleProviderArgs: Parameters<typeof firstCompatibleProvider>[0] = { providers: syncProviders, replicationType: vault.vaultArchitecture.replication_type, preference: selectedProviderIdState };
    const selection = firstCompatibleProvider(
      firstCompatibleProviderArgs,
    )
    return selection.kind === CompatibleProviderSelectionKind.Selected
      ? selection.provider.id
      : ''
  })
  const effectivePasswordEntryId = $derived.by(() => {
    if (passwordEntry.kind === PasswordEntrySelectionKind.Selected) {
      const selectedEntryId = passwordEntry.entryId
      if (passwordEntries.some((entry) => entry.id === selectedEntryId)) {
        return selectedEntryId
      }
    }
    return ''
  })
  const selectedProvider = $derived.by((): ResolvedOnboardingProvider => {
    const provider = syncProviders.find(
      (candidate) => candidate.id === effectiveProviderId,
    )
    return provider
      ? { kind: ResolvedOnboardingProviderKind.Available, provider }
      : { kind: ResolvedOnboardingProviderKind.Unavailable }
  })
  const derivedOnboardingType = $derived(
    selectedProvider.kind === ResolvedOnboardingProviderKind.Available
      ? provider_onboarding_type(
          selectedProvider.provider,
          vault.vaultArchitecture,
        )
      : vault_architecture_onboarding_type(vault.vaultArchitecture),
  )
  const usesSharedProviderGrant = $derived(
    derivedOnboardingType === OnboardingType.SharedProviderGrant,
  )
  const onboardingTypeTitleKey = $derived(
    derivedOnboardingType === OnboardingType.SharedProviderGrant
      ? I18N_KEYS.ArchitectureModesOnboardingTypeSharedProviderGrantTitle
      : I18N_KEYS.ArchitectureModesOnboardingTypePersonalCredentialTransferTitle,
  )
  const onboardingTypeDescriptionKey = $derived(
    derivedOnboardingType === OnboardingType.SharedProviderGrant
      ? I18N_KEYS.ArchitectureModesOnboardingTypeSharedProviderGrantDescription
      : I18N_KEYS.ArchitectureModesOnboardingTypePersonalCredentialTransferDescription,
  )
  const requiresSharedJoinerIdentity = $derived(
    usesSharedProviderGrant &&
      selectedProvider.kind === ResolvedOnboardingProviderKind.Available &&
      !isICloudProvider(selectedProvider.provider),
  )
  const selectedPassword = $derived.by((): ResolvedOnboardingPassword => {
    const entry = passwordEntries.find(
      (candidate) => candidate.id === effectivePasswordEntryId,
    )
    return entry
      ? { kind: ResolvedOnboardingPasswordKind.Available, entry }
      : { kind: ResolvedOnboardingPasswordKind.Unavailable }
  })
  const hasPasswordSelection = $derived(
    selectedPassword.kind === ResolvedOnboardingPasswordKind.Available,
  )
  const wizardReady = $derived(
    hasPasswordSelection && hasCompatibleSyncProviders,
  )
  const enrollmentLink = $derived.by(() => {
    if (!enrollmentCode) return ''
    const enrollmentLinkRequest: Parameters<typeof buildEnrollmentLink>[0] = {
      code: enrollmentCode,
      baseUrl: getEnrollmentLinkBase(),
    }
    return buildEnrollmentLink(enrollmentLinkRequest)
  })
  const issuedAt = $derived.by(() => {
    if (!enrollmentCode) return ''
    return peek_enrollment_issued_at(enrollmentCode)
  })
  const showGenerating = $derived(
    (isGenerating || isBusy) && !enrollmentCode && !localError,
  )

  const passwordStepSubtitle = $derived(
    selectedPassword.kind === ResolvedOnboardingPasswordKind.Available
      ? (() => { const tArgs2: Parameters<typeof vault.t>[0] = { key: I18N_KEYS.OnboardDeviceWizardPasswordSelected, replacements: {
          label: selectedPassword.entry.label,
        } }; return vault.t(tArgs2); })()
      : hasPasswords
        ? passwordEntries.length === 1
          ? vault.t(I18N_KEYS.OnboardDeviceWizardPasswordChooseSingular)
          : (() => { const tArgs: Parameters<typeof vault.t>[0] = { key: I18N_KEYS.OnboardDeviceWizardPasswordChoosePlural, replacements: {
              count: String(passwordEntries.length),
            } }; return vault.t(tArgs); })()
        : vault.t(I18N_KEYS.OnboardDeviceWizardPasswordSubtitle),
  )

  const syncStepSubtitle = $derived(
    hasCompatibleSyncProviders
      ? compatibleSyncProviders.length === 1
        ? (() => { const translationRequest: Parameters<typeof vault.t>[0] = {
            key: I18N_KEYS.OnboardDeviceWizardSyncReadySingular,
            replacements: {
              label: (() => { const localizeProviderLabelArgs: Parameters<typeof localizeProviderLabel>[0] = {
                label: compatibleSyncProviders[0]?.label ?? '',
                t: vault.t,
              }; return localizeProviderLabel(localizeProviderLabelArgs); })(),
            },
          }; return vault.t(translationRequest); })()
        : (() => { const tArgs3: Parameters<typeof vault.t>[0] = { key: I18N_KEYS.OnboardDeviceWizardSyncReadyPlural, replacements: {
            count: String(compatibleSyncProviders.length),
          } }; return vault.t(tArgs3); })()
      : hasSyncProviders
        ? vault.t(I18N_KEYS.OnboardDeviceNoCompatibleSyncProviders)
        : hasPasswords
          ? vault.t(I18N_KEYS.OnboardDeviceWizardSyncSubtitle)
          : vault.t(I18N_KEYS.LoginWizardAvailableAfterConnect),
  )

  const generateStepSubtitle = $derived(
    wizardReady
      ? vault.t(I18N_KEYS.OnboardDeviceWizardGenerateSubtitleReady)
      : vault.t(I18N_KEYS.OnboardDeviceWizardGenerateSubtitleLocked),
  )

  $effect(() => {
    if (enrollmentCode) {
      passwordStepOpen = false
      syncStepOpen = false
      generateStepOpen = false
      return
    }
    if (!hasPasswords) {
      passwordStepOpen = true
      syncStepOpen = false
      generateStepOpen = false
      return
    }
    if (!hasPasswordSelection) {
      passwordStepOpen = true
      syncStepOpen = false
      generateStepOpen = false
      return
    }
    if (!hasCompatibleSyncProviders) {
      passwordStepOpen = false
      syncStepOpen = true
      generateStepOpen = false
      return
    }
    passwordStepOpen = false
    syncStepOpen = false
    generateStepOpen = true
  })

  async function submitOnboard() {
    localError = ''
    onClearCode()
    if (selectedProvider.kind === ResolvedOnboardingProviderKind.Unavailable) {
      localError = vault.t(I18N_KEYS.OnboardDeviceChooseSyncProviderErr)
      return
    }
    if (selectedPassword.kind === ResolvedOnboardingPasswordKind.Unavailable) {
      localError = vault.t(I18N_KEYS.OnboardDeviceChoosePwErr)
      return
    }
    if (!passwordInput) {
      localError = vault.t(I18N_KEYS.OnboardDeviceEnterPwErr)
      return
    }
    if (requiresSharedJoinerIdentity && !vault.sharedJoinerIdentity.trim()) {
      localError = vault.t(I18N_KEYS.OnboardDeviceSharedIdentityRequired)
      return
    }
    isGenerating = true
    try {
      const issueRequest: Parameters<typeof onIssueCode>[0] = {
        entryId: selectedPassword.entry.id,
        password: passwordInput,
        providerId: selectedProvider.provider.id,
      }
      await onIssueCode(issueRequest)
      passwordInput = ''
    } catch (e) {
      localError =
        e instanceof Error ? e.message : vault.t(I18N_KEYS.OnboardDeviceFailedQrErr)
    } finally {
      isGenerating = false
    }
  }
</script>

<section
  class="space-y-4 animate-in fade-in duration-200"
  data-testid="onboard-device-panel"
>
  <div class="space-y-1">
    <h2 class="text-base font-semibold text-foreground">
      {vault.t(I18N_KEYS.OnboardDeviceTitle)}
    </h2>
    <p class="text-xs text-muted-foreground text-pretty">
      {vault.t(
        isSentinelVault
          ? I18N_KEYS.OnboardDeviceSentinelDesc
          : I18N_KEYS.OnboardDeviceDesc,
      )}
    </p>
  </div>

  {#if isSentinelVault}
    <SentinelOnboardingGuidance
      {vault}
      readyParticipants={sentinelReadyParticipants}
      requiredParticipants={sentinelRequiredParticipants}
      compatibleProviderCount={compatibleSyncProviders.length}
    />
  {:else}
    <div class="space-y-3">
      <OnboardDevicePasswordStep
        {vault}
        {passwordEntries}
        {effectivePasswordEntryId}
        subtitle={passwordStepSubtitle}
        {isBusy}
        {isGenerating}
        {passwordError}
        bind:open={passwordStepOpen}
        {onAddPassword}
        {onSelectPasswordEntry}
      />

      <SetupWizardStep
        stepNumber={2}
        title={vault.t(I18N_KEYS.OnboardDeviceWizardSyncStep)}
        subtitle={syncStepSubtitle}
        disabled={!hasPasswordSelection}
        bind:open={syncStepOpen}
        testId="onboard-wizard-sync-step"
      >
        {#if addingProvider}
          <div class="space-y-4">
            <button
              type="button"
              class="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              data-testid="cancel-add-provider-btn"
              onclick={() =>
                showSetup ? onCancelSetup() : onCancelAddProvider?.()}
            >
              <ChevronLeft class="size-3.5" />
              {vault.t(I18N_KEYS.OnboardingBackToSaved)}
            </button>

            {#if showSetup}
              {#if setupIs('oauth-file')}
                <OAuthProviderSetupWizard
                  {vault}
                  bind:githubRepo
                  idPrefix="onboard"
                  preset={oauthPreset}
                  {isVerifying}
                  {isInitializing}
                  {onCancelSetup}
                  onConnect={onConnectProvider}
                />
              {:else if setupIs('github')}
                <GitHubProviderSetupWizard
                  {vault}
                  bind:githubPat
                  bind:githubRepo
                  idPrefix="onboard"
                  {isVerifying}
                  {isInitializing}
                  {onCancelSetup}
                  onConnect={onConnectProvider}
                />
              {:else if setupIs('local-folder')}
                <LocalFolderProviderSetupWizard
                  {vault}
                  idPrefix="onboard"
                  {isVerifying}
                  {isInitializing}
                  {onCancelSetup}
                  onConnect={onConnectProvider}
                />
              {:else}
                <ProviderSetupFields {vault} {onCancelSetup} />
              {/if}
            {:else}
              <ProviderPicker {vault} onSelect={onBeginSetup} excludeLocal />
            {/if}
          </div>
        {:else if !hasSyncProviders}
          <p class="text-sm text-muted-foreground text-pretty">
            {vault.t(I18N_KEYS.OnboardDeviceWizardSyncEmptyDesc)}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="add-provider-btn"
            onclick={() => onBeginAddProvider?.()}
          >
            <Plus class="size-4" />
            {vault.t(I18N_KEYS.SettingsAddSyncProvider)}
          </Button>
        {:else}
          <div
            class="space-y-1.5"
            role="radiogroup"
            aria-label={vault.t(I18N_KEYS.OnboardDeviceSyncProvider)}
            data-testid="onboard-provider-list"
          >
            {#each syncProviders as provider (provider.id)}
              {@const selected = provider.id === effectiveProviderId}
              {@const compatible = provider_supports_replication(
                provider,
                vault.vaultArchitecture.replication_type,
              )}
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                class="flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-all {selected
                  ? 'border-primary/35 bg-primary/[0.08] text-foreground shadow-sm ring-1 ring-inset ring-primary/35'
                  : 'border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground'}"
                data-testid="onboard-provider-{provider.id}"
                disabled={isBusy || isGenerating || !compatible}
                onclick={() => {
                  if (compatible) {
                    selectedProviderIdState = {
                      kind: ProviderSelectionKind.Selected,
                      providerId: provider.id,
                    }
                  }
                }}
              >
                <span
                  class="inline-flex size-[18px] shrink-0 items-center justify-center rounded-full border-2 {selected
                    ? 'border-primary'
                    : 'border-muted-foreground/35'}"
                  aria-hidden="true"
                >
                  {#if selected}
                    <span class="size-2 rounded-full bg-primary"></span>
                  {/if}
                </span>
                {#if provider.type === GITHUB_PROVIDER_TYPE}
                  <Cloud class="size-4 shrink-0 opacity-80" />
                {:else}
                  <HardDrive class="size-4 shrink-0 opacity-80" />
                {/if}
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <span class="truncate font-medium"
                      >{(() => { const localizeProviderLabelArgs2: Parameters<typeof localizeProviderLabel>[0] = { label: provider.label, t: vault.t }; return localizeProviderLabel(localizeProviderLabelArgs2); })()}</span
                    >
                  </div>
                  <div
                    class="truncate text-xs {selected
                      ? 'text-muted-foreground'
                      : 'text-muted-foreground/80'}"
                    data-testid="onboard-provider-detail-{provider.id}"
                  >
                    {(() => { const providerStorageDetailArgs: Parameters<typeof providerStorageDetail>[0] = { provider, t: vault.t }; return providerStorageDetail(providerStorageDetailArgs); })()}
                  </div>
                  <div
                    class="text-[11px] {compatible
                      ? 'text-muted-foreground'
                      : 'text-amber-700 dark:text-amber-300'}"
                    data-testid="onboard-provider-capability-{provider.id}"
                  >
                    {vault.t(providerCapabilityLabelKey(provider))}
                    {#if !compatible}
                      · {vault.t(I18N_KEYS.ProviderPickerUnsupportedCurrentVault)}
                    {/if}
                  </div>
                </div>
              </button>
            {/each}
          </div>

          {#if !hasCompatibleSyncProviders}
            <p
              class="text-xs text-amber-700 dark:text-amber-300"
              data-testid="onboard-no-compatible-provider"
            >
              {vault.t(I18N_KEYS.OnboardDeviceNoCompatibleSyncProviders)}
            </p>
          {/if}

          <div class="flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="onboard-add-another-provider-btn"
              onclick={() => onBeginAddProvider?.()}
            >
              <Plus class="size-4" />
              {vault.t(I18N_KEYS.SettingsAddSyncProvider)}
            </Button>
          </div>
        {/if}
      </SetupWizardStep>

      <SetupWizardStep
        stepNumber={3}
        title={vault.t(I18N_KEYS.OnboardDeviceWizardGenerateStep)}
        subtitle={generateStepSubtitle}
        disabled={!wizardReady}
        bind:open={generateStepOpen}
        testId="onboard-wizard-generate-step"
      >
        <form
          class="space-y-4"
          onsubmit={(event) => {
            event.preventDefault()
            void submitOnboard()
          }}
        >
          {#if selectedPassword.kind === ResolvedOnboardingPasswordKind.Available}
            <div
              class="rounded-lg border border-border bg-muted/20 px-3 py-2.5"
              data-testid="onboard-password-selected-summary"
            >
              <p class="text-xs font-medium text-muted-foreground">
                {vault.t(I18N_KEYS.OnboardDeviceVaultPassword)}
              </p>
              <p class="truncate text-sm font-medium text-foreground">
                {selectedPassword.entry.label}
              </p>
            </div>
          {/if}

          <div class="space-y-1.5">
            <label
              for="onboard-password"
              class="text-xs font-medium text-foreground"
            >
              {selectedPassword.kind ===
              ResolvedOnboardingPasswordKind.Available
                ? (() => { const tArgs8: Parameters<typeof vault.t>[0] = { key: I18N_KEYS.VaultPasswordsPasswordFor, replacements: {
                    label: selectedPassword.entry.label,
                  } }; return vault.t(tArgs8); })()
                : vault.t(I18N_KEYS.VaultPasswordsConfirmPassword)}
            </label>
            <input
              id="onboard-password"
              type="password"
              class="flex h-9 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-hidden focus:ring-2 focus:ring-ring"
              bind:value={passwordInput}
              autocomplete="current-password"
              disabled={isBusy || isGenerating}
              data-testid="onboard-password-input"
            />
          </div>

          <div
            class="rounded-md border border-border bg-muted/20 px-3 py-2.5"
            data-testid="onboarding-type-summary"
          >
            <p
              class="text-xs font-medium text-foreground"
              data-testid="onboarding-type-label"
            >
              {vault.t(onboardingTypeTitleKey)}
            </p>
            <p
              class="mt-1 text-xs text-muted-foreground text-pretty"
              data-testid="onboarding-type-description"
            >
              {vault.t(onboardingTypeDescriptionKey)}
            </p>
          </div>

          {#if requiresSharedJoinerIdentity}
            <div class="space-y-1.5">
              <label
                for="shared-joiner-identity"
                class="text-xs font-medium text-foreground"
              >
                {vault.t(I18N_KEYS.OnboardDeviceSharedIdentityLabel)}
              </label>
              <input
                id="shared-joiner-identity"
                type="email"
                class="flex h-9 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-hidden focus:ring-2 focus:ring-ring"
                bind:value={vault.sharedJoinerIdentity}
                autocomplete="email"
                disabled={isBusy || isGenerating}
                placeholder={vault.t(
                  I18N_KEYS.OnboardDeviceSharedIdentityPlaceholder,
                )}
                data-testid="shared-joiner-identity-input"
              />
              <p class="text-xs text-muted-foreground">
                {vault.t(I18N_KEYS.OnboardDeviceSharedIdentityHint)}
              </p>
            </div>
          {/if}

          {#if localError}
            <p class="text-xs text-destructive" data-testid="onboard-error">
              {localError}
            </p>
          {/if}

          <div class="flex justify-end">
            <Button
              type="submit"
              disabled={isBusy || isGenerating}
              data-testid="onboard-device-submit"
            >
              {#if isBusy || isGenerating}
                <RefreshCw class="size-4 animate-spin" />
                {vault.t(I18N_KEYS.OnboardDeviceGenerating)}
              {:else}
                <QrCode class="size-4" />
                {vault.t(I18N_KEYS.OnboardDeviceTitle)}
              {/if}
            </Button>
          </div>
        </form>
      </SetupWizardStep>
    </div>

    {#if showGenerating}
      <div
        class="flex items-center gap-3 rounded-lg border border-border bg-muted/20 p-4"
        data-testid="onboard-generating"
        role="status"
        aria-live="polite"
      >
        <RefreshCw class="size-5 shrink-0 animate-spin text-primary" />
        <p class="text-sm text-muted-foreground">
          {vault.t(I18N_KEYS.OnboardDeviceGeneratingQr)}
        </p>
      </div>
    {/if}

    {#if enrollmentCode}
      <EnrollmentOnboardResult
        {vault}
        {enrollmentLink}
        instruction={vault.t(I18N_KEYS.OnboardDeviceReadyDesc)}
        issuedSuffix={issuedAt
          ? (() => { const tArgs9: Parameters<typeof vault.t>[0] = { key: I18N_KEYS.OnboardDeviceIssuedTime, replacements: {
              time: issuedAt.slice(0, 19).replace('T', ' ') + ' UTC',
            } }; return vault.t(tArgs9); })()
          : ''}
        linkTitle={vault.t(I18N_KEYS.OnboardDeviceLinkTitle)}
        linkDescription={vault.t(I18N_KEYS.OnboardDeviceLinkDesc)}
        passwordReminder={vault.t(I18N_KEYS.OnboardDeviceSharePassword)}
      />
      {#if vault.sharedGrantInstructions}
        <div
          class="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-foreground"
          data-testid="shared-grant-instructions"
        >
          {vault.sharedGrantInstructions}
        </div>
      {/if}
    {/if}
  {/if}
</section>
