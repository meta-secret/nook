<script lang="ts">
  import { I18N_KEYS } from '../../../generated/i18n-keys'
  import {
    ChevronLeft,
    Cloud,
    HardDrive,
    Plus,
    QrCode,
    RefreshCw,
    ShieldCheck,
    Users,
  } from '@lucide/svelte'
  import EnrollmentOnboardResult from '$lib/components/EnrollmentOnboardResult.svelte'
  import GitHubProviderSetupWizard from '$lib/components/GitHubProviderSetupWizard.svelte'
  import LocalFolderProviderSetupWizard from '$lib/components/LocalFolderProviderSetupWizard.svelte'
  import OAuthProviderSetupWizard from '$lib/components/OAuthProviderSetupWizard.svelte'
  import ProviderPicker from '$lib/components/ProviderPicker.svelte'
  import ProviderSetupFields from '$lib/components/ProviderSetupFields.svelte'
  import SetupWizardStep from '$lib/components/SetupWizardStep.svelte'
  import { Button } from '$lib/components/ui/button'
  import { buildEnrollmentLink } from '$lib/enrollment/code'
  import {
    GITHUB_PROVIDER_TYPE,
    isICloudProvider,
    localizeProviderLabel,
    providerStorageDetail,
    type OAuthFilePreset,
    type StorageProvider,
    type StorageProviderType,
  } from '$lib/auth/providers'
  import {
    isVaultPasswordLongEnough,
    peekEnrollmentIssuedAt,
    type NookPasswordEntrySummary,
    type PasswordEntryId,
  } from '$app-wasm'
  import type { VaultState } from '$lib/vault.svelte'
  import {
    AdminAccordionSection,
    SettingsAccordionSection,
    SettingsSection,
  } from '$lib/vault/state/ui.svelte'
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
    onboardingType,
    providerCapabilityLabelKey,
    providerOnboardingType,
    providerSupportsReplication,
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
      entryId: PasswordEntryId,
      password: string,
      providerId: string,
    ) => Promise<string>
    onClearCode: () => void
    onAddPassword: (label: string, password: string) => void | Promise<void>
    onBeginAddProvider?: () => void
    onCancelAddProvider?: () => void
    onBeginSetup: (
      type: StorageProviderType,
      oauthPreset?: OAuthFilePreset,
    ) => void
    onCancelSetup: () => void
    onConnectProvider: () => void | Promise<void>
  } = $props()

  const hasPasswords = $derived(passwordEntries.length > 0)
  const hasSyncProviders = $derived(syncProviders.length > 0)
  const compatibleSyncProviders = $derived(
    syncProviders.filter((provider) =>
      providerSupportsReplication(
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
        : 'google-drive',
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

  let passwordLabelInput = $state('')
  let newPasswordInput = $state('')
  let newPasswordConfirm = $state('')
  let passwordFormError = $state('')

  let passwordStepOpen = $state(true)
  let syncStepOpen = $state(false)
  let generateStepOpen = $state(false)

  const effectiveProviderId = $derived.by(() => {
    const selection = firstCompatibleProvider(
      syncProviders,
      vault.vaultArchitecture.replication_type,
      selectedProviderIdState,
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
      ? providerOnboardingType(
          selectedProvider.provider,
          vault.vaultArchitecture,
        )
      : onboardingType(vault.vaultArchitecture),
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
  const enrollmentLink = $derived.by(() =>
    enrollmentCode ? buildEnrollmentLink(enrollmentCode) : '',
  )
  const issuedAt = $derived.by(() => {
    if (!enrollmentCode) return ''
    return peekEnrollmentIssuedAt(enrollmentCode)
  })
  const showGenerating = $derived(
    (isGenerating || isBusy) && !enrollmentCode && !localError,
  )

  const passwordStepSubtitle = $derived(
    selectedPassword.kind === ResolvedOnboardingPasswordKind.Available
      ? vault.t(I18N_KEYS.OnboardDeviceWizardPasswordSelected, {
          label: selectedPassword.entry.label,
        })
      : hasPasswords
        ? passwordEntries.length === 1
          ? vault.t(I18N_KEYS.OnboardDeviceWizardPasswordChooseSingular)
          : vault.t(I18N_KEYS.OnboardDeviceWizardPasswordChoosePlural, {
              count: String(passwordEntries.length),
            })
        : vault.t(I18N_KEYS.OnboardDeviceWizardPasswordSubtitle),
  )

  const syncStepSubtitle = $derived(
    hasCompatibleSyncProviders
      ? compatibleSyncProviders.length === 1
        ? vault.t(I18N_KEYS.OnboardDeviceWizardSyncReadySingular, {
            label: localizeProviderLabel(
              compatibleSyncProviders[0]?.label ?? '',
              vault.t,
            ),
          })
        : vault.t(I18N_KEYS.OnboardDeviceWizardSyncReadyPlural, {
            count: String(compatibleSyncProviders.length),
          })
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

  async function submitAddPassword() {
    passwordFormError = ''
    if (!passwordLabelInput.trim()) {
      passwordFormError = vault.t(I18N_KEYS.VaultPasswordsEnterLabelError)
      return
    }
    if (!isVaultPasswordLongEnough(newPasswordInput)) {
      passwordFormError = vault.t(I18N_KEYS.VaultPasswordsMinLengthError)
      return
    }
    if (newPasswordInput !== newPasswordConfirm) {
      passwordFormError = vault.t(I18N_KEYS.VaultPasswordsMismatchError)
      return
    }
    try {
      await onAddPassword(passwordLabelInput.trim(), newPasswordInput)
      passwordLabelInput = ''
      newPasswordInput = ''
      newPasswordConfirm = ''
    } catch {
      // surfaced via passwordError prop
    }
  }

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
      await onIssueCode(
        selectedPassword.entry.id,
        passwordInput,
        selectedProvider.provider.id,
      )
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
    <div
      class="space-y-4 rounded-lg border border-primary/20 bg-primary/[0.04] p-4"
      data-testid="sentinel-onboard-guidance"
    >
      <div class="flex items-start gap-3">
        <div
          class="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
          aria-hidden="true"
        >
          <Users class="size-4.5" />
        </div>
        <div class="min-w-0 space-y-1">
          <h3 class="text-sm font-semibold text-foreground">
            {vault.t(I18N_KEYS.OnboardDeviceSentinelTitle)}
          </h3>
          <p class="text-sm text-muted-foreground text-pretty">
            {vault.t(I18N_KEYS.OnboardDeviceSentinelNoPasswordDesc)}
          </p>
        </div>
      </div>

      <div
        class="rounded-md border border-border bg-background/70 px-3 py-2.5"
        data-testid="sentinel-participant-readiness"
      >
        <p class="text-xs font-medium text-muted-foreground">
          {vault.t(I18N_KEYS.OnboardDeviceSentinelReadinessLabel)}
        </p>
        <p class="mt-0.5 text-sm font-semibold text-foreground">
          {vault.t(I18N_KEYS.OnboardDeviceSentinelReadinessCount, {
            ready: String(sentinelReadyParticipants),
            required: String(sentinelRequiredParticipants),
          })}
        </p>
      </div>

      <ol class="space-y-3 text-sm text-foreground">
        <li class="flex gap-3">
          <span
            class="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground"
            >1</span
          >
          <span>{vault.t(I18N_KEYS.OnboardDeviceSentinelStepConnect)}</span>
        </li>
        <li class="flex gap-3">
          <span
            class="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground"
            >2</span
          >
          <span>{vault.t(I18N_KEYS.OnboardDeviceSentinelStepApprove)}</span>
        </li>
      </ol>

      <p
        class="text-xs {hasCompatibleSyncProviders
          ? 'text-muted-foreground'
          : 'text-amber-700 dark:text-amber-300'}"
        data-testid="sentinel-compatible-provider-status"
      >
        {hasCompatibleSyncProviders
          ? vault.t(I18N_KEYS.OnboardDeviceSentinelProviderReady, {
              count: String(compatibleSyncProviders.length),
            })
          : vault.t(I18N_KEYS.OnboardDeviceSentinelProviderMissing)}
      </p>

      <div class="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="sentinel-manage-providers"
          onclick={() => vault.openAdmin(AdminAccordionSection.Storage)}
        >
          <Cloud class="size-4" />
          {vault.t(I18N_KEYS.OnboardDeviceSentinelManageProviders)}
        </Button>
        <Button
          type="button"
          size="sm"
          data-testid="sentinel-review-joins"
          onclick={() =>
            vault.openSettings(
              SettingsSection.Storage,
              SettingsAccordionSection.Devices,
            )}
        >
          <ShieldCheck class="size-4" />
          {vault.t(I18N_KEYS.OnboardDeviceSentinelReviewJoins)}
        </Button>
      </div>
    </div>
  {:else}
    <div class="space-y-3">
      <SetupWizardStep
        stepNumber={1}
        title={vault.t(I18N_KEYS.OnboardDeviceWizardPasswordStep)}
        subtitle={passwordStepSubtitle}
        bind:open={passwordStepOpen}
        testId="onboard-wizard-password-step"
      >
        {#if hasPasswords}
          <div class="space-y-3">
            <p class="text-sm text-muted-foreground text-pretty">
              {vault.t(I18N_KEYS.OnboardDeviceWizardPasswordExistingDesc)}
            </p>

            <div
              class="space-y-1.5"
              role="radiogroup"
              aria-label={vault.t(I18N_KEYS.OnboardDeviceVaultPassword)}
              data-testid="onboard-password-entry-list"
            >
              {#each passwordEntries as entry (entry.id)}
                {@const selected = entry.id === effectivePasswordEntryId}
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  class="flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-all {selected
                    ? 'border-primary/35 bg-primary/[0.08] text-foreground shadow-sm ring-1 ring-inset ring-primary/35'
                    : 'border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground'}"
                  data-testid="onboard-password-entry-{entry.id}"
                  disabled={isBusy || isGenerating}
                  onclick={() => {
                    passwordEntry = {
                      kind: PasswordEntrySelectionKind.Selected,
                      entryId: entry.id,
                    }
                    passwordInput = ''
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
                  <ShieldCheck class="size-4 shrink-0 opacity-80" />
                  <span class="min-w-0 flex-1">
                    <span class="block truncate font-medium">{entry.label}</span
                    >
                    {#if entry.createdAt}
                      <span
                        class="block truncate text-[11px] {selected
                          ? 'text-muted-foreground'
                          : 'text-muted-foreground/80'}"
                      >
                        {vault.t(I18N_KEYS.VaultPasswordsAddedDate, {
                          date: entry.createdAt.slice(0, 10),
                        })}
                      </span>
                    {/if}
                  </span>
                </button>
              {/each}
            </div>
          </div>
        {:else}
          <form
            class="space-y-4"
            data-testid="onboard-password-prerequisite"
            onsubmit={(event) => {
              event.preventDefault()
              void submitAddPassword()
            }}
          >
            <p class="text-sm text-foreground text-pretty">
              {vault.t(I18N_KEYS.OnboardDevicePasswordRequiredDesc)}
            </p>

            <div class="space-y-1.5">
              <label
                for="onboard-vault-pw-label"
                class="text-xs font-medium text-foreground"
              >
                {vault.t(I18N_KEYS.VaultPasswordsLabel)}
              </label>
              <input
                id="onboard-vault-pw-label"
                type="text"
                class="flex h-9 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-hidden focus:ring-2 focus:ring-ring"
                placeholder={vault.t(I18N_KEYS.VaultPasswordsLabelPlaceholder)}
                bind:value={passwordLabelInput}
                data-testid="vault-password-label"
              />
            </div>

            <div class="space-y-1.5">
              <label
                for="onboard-vault-pw"
                class="text-xs font-medium text-foreground"
              >
                {vault.t(I18N_KEYS.VaultFieldsPassword)}
              </label>
              <input
                id="onboard-vault-pw"
                type="password"
                class="flex h-9 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-hidden focus:ring-2 focus:ring-ring"
                bind:value={newPasswordInput}
                autocomplete="new-password"
                data-testid="vault-password-input"
              />
            </div>

            <div class="space-y-1.5">
              <label
                for="onboard-vault-pw-confirm"
                class="text-xs font-medium text-foreground"
              >
                {vault.t(I18N_KEYS.VaultPasswordsConfirmPassword)}
              </label>
              <input
                id="onboard-vault-pw-confirm"
                type="password"
                class="flex h-9 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-hidden focus:ring-2 focus:ring-ring"
                bind:value={newPasswordConfirm}
                autocomplete="new-password"
                data-testid="vault-password-confirm"
              />
            </div>

            {#if passwordFormError || passwordError}
              <p
                class="text-xs text-destructive"
                data-testid="vault-password-error"
              >
                {passwordFormError || passwordError}
              </p>
            {/if}

            <div class="flex justify-end">
              <Button
                type="submit"
                size="sm"
                disabled={isBusy}
                data-testid="submit-vault-password"
              >
                {#if isBusy}
                  <RefreshCw class="size-3.5 animate-spin" />
                  {vault.t(I18N_KEYS.VaultPasswordsWorking)}
                {:else}
                  <ShieldCheck class="size-3.5" />
                  {vault.t(I18N_KEYS.VaultPasswordsAddPassword)}
                {/if}
              </Button>
            </div>
          </form>
        {/if}
      </SetupWizardStep>

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
              {@const compatible = providerSupportsReplication(
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
                      >{localizeProviderLabel(provider.label, vault.t)}</span
                    >
                  </div>
                  <div
                    class="truncate text-xs {selected
                      ? 'text-muted-foreground'
                      : 'text-muted-foreground/80'}"
                    data-testid="onboard-provider-detail-{provider.id}"
                  >
                    {providerStorageDetail(provider, vault.t)}
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
                ? vault.t(I18N_KEYS.VaultPasswordsPasswordFor, {
                    label: selectedPassword.entry.label,
                  })
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
          ? vault.t(I18N_KEYS.OnboardDeviceIssuedTime, {
              time: issuedAt.slice(0, 19).replace('T', ' ') + ' UTC',
            })
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
