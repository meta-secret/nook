<script lang="ts">
  import {
    ChevronLeft,
    Cloud,
    HardDrive,
    Plus,
    QrCode,
    RefreshCw,
    ShieldCheck,
  } from '@lucide/svelte'
  import EnrollmentOnboardResult from '$lib/components/EnrollmentOnboardResult.svelte'
  import GitHubProviderSetupWizard from '$lib/components/GitHubProviderSetupWizard.svelte'
  import LocalFolderProviderSetupWizard from '$lib/components/LocalFolderProviderSetupWizard.svelte'
  import OAuthProviderSetupWizard from '$lib/components/OAuthProviderSetupWizard.svelte'
  import ProviderPicker from '$lib/components/ProviderPicker.svelte'
  import ProviderSetupFields from '$lib/components/ProviderSetupFields.svelte'
  import SetupWizardStep from '$lib/components/SetupWizardStep.svelte'
  import { Button } from '$lib/components/ui/button'
  import { buildEnrollmentLink } from '$lib/enrollment-code'
  import {
    localizeProviderLabel,
    providerStorageDetail,
    type OAuthFilePreset,
    type StorageProvider,
    type StorageProviderType,
  } from '$lib/auth-providers'
  import {
    isVaultPasswordLongEnough,
    peekEnrollmentIssuedAt,
    type NookPasswordEntrySummary,
  } from '$lib/nook-wasm/nook_wasm'
  import type { VaultState } from '$lib/vault.svelte'

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
    setupType = $bindable(undefined as StorageProviderType | undefined),
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
    setupType?: StorageProviderType | undefined
    githubPat: string
    githubRepo: string
    onIssueCode: (
      entryId: string,
      password: string,
      providerId: string,
    ) => Promise<string | void>
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
  const showSetup = $derived(setupType !== undefined)
  const addingProvider = $derived(addProviderOpen || showSetup)

  let providerId = $state<string | undefined>(undefined)
  let passwordEntryId = $state<string | undefined>(undefined)
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
    if (
      providerId !== undefined &&
      syncProviders.some((provider) => provider.id === providerId)
    ) {
      return providerId
    }
    return syncProviders[0]?.id ?? ''
  })
  const effectivePasswordEntryId = $derived.by(() => {
    if (
      passwordEntryId !== undefined &&
      passwordEntries.some((entry) => entry.id === passwordEntryId)
    ) {
      return passwordEntryId
    }
    return ''
  })
  const selectedProvider = $derived(
    syncProviders.find((provider) => provider.id === effectiveProviderId) ??
      undefined,
  )
  const selectedPassword = $derived(
    passwordEntries.find((entry) => entry.id === effectivePasswordEntryId) ??
      undefined,
  )
  const hasPasswordSelection = $derived(selectedPassword !== undefined)
  const wizardReady = $derived(hasPasswordSelection && hasSyncProviders)
  const enrollmentLink = $derived.by(() =>
    enrollmentCode ? buildEnrollmentLink(enrollmentCode) : '',
  )
  const issuedAt = $derived.by(() => {
    if (!enrollmentCode) return ''
    return peekEnrollmentIssuedAt(enrollmentCode) ?? ''
  })
  const showGenerating = $derived(
    (isGenerating || isBusy) && !enrollmentCode && !localError,
  )

  const passwordStepSubtitle = $derived(
    selectedPassword
      ? vault.t('onboard_device.wizard_password_selected', {
          label: selectedPassword.label,
        })
      : hasPasswords
        ? passwordEntries.length === 1
          ? vault.t('onboard_device.wizard_password_choose_singular')
          : vault.t('onboard_device.wizard_password_choose_plural', {
              count: String(passwordEntries.length),
            })
        : vault.t('onboard_device.wizard_password_subtitle'),
  )

  const syncStepSubtitle = $derived(
    hasSyncProviders
      ? syncProviders.length === 1
        ? vault.t('onboard_device.wizard_sync_ready_singular', {
            label: localizeProviderLabel(
              syncProviders[0]?.label ?? '',
              vault.t,
            ),
          })
        : vault.t('onboard_device.wizard_sync_ready_plural', {
            count: String(syncProviders.length),
          })
      : hasPasswords
        ? vault.t('onboard_device.wizard_sync_subtitle')
        : vault.t('login_wizard.available_after_connect'),
  )

  const generateStepSubtitle = $derived(
    wizardReady
      ? vault.t('onboard_device.wizard_generate_subtitle_ready')
      : vault.t('onboard_device.wizard_generate_subtitle_locked'),
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
    if (!hasSyncProviders) {
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
      passwordFormError = vault.t('vault_passwords.enter_label_error')
      return
    }
    if (!isVaultPasswordLongEnough(newPasswordInput)) {
      passwordFormError = vault.t('vault_passwords.min_length_error')
      return
    }
    if (newPasswordInput !== newPasswordConfirm) {
      passwordFormError = vault.t('vault_passwords.mismatch_error')
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
    if (!selectedProvider) {
      localError = vault.t('onboard_device.choose_sync_provider_err')
      return
    }
    if (!selectedPassword) {
      localError = vault.t('onboard_device.choose_pw_err')
      return
    }
    if (!passwordInput) {
      localError = vault.t('onboard_device.enter_pw_err')
      return
    }
    isGenerating = true
    try {
      await onIssueCode(selectedPassword.id, passwordInput, selectedProvider.id)
      passwordInput = ''
    } catch (e: unknown) {
      localError =
        e instanceof Error ? e.message : vault.t('onboard_device.failed_qr_err')
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
      {vault.t('onboard_device.title')}
    </h2>
    <p class="text-xs text-muted-foreground text-pretty">
      {vault.t('onboard_device.desc')}
    </p>
  </div>

  <div class="space-y-3">
    <SetupWizardStep
      stepNumber={1}
      title={vault.t('onboard_device.wizard_password_step')}
      subtitle={passwordStepSubtitle}
      bind:open={passwordStepOpen}
      testId="onboard-wizard-password-step"
    >
      {#if hasPasswords}
        <div class="space-y-3">
          <p class="text-sm text-muted-foreground text-pretty">
            {vault.t('onboard_device.wizard_password_existing_desc')}
          </p>

          <div
            class="space-y-1.5"
            role="radiogroup"
            aria-label={vault.t('onboard_device.vault_password')}
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
                  passwordEntryId = entry.id
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
                  <span class="block truncate font-medium">{entry.label}</span>
                  {#if entry.createdAt}
                    <span
                      class="block truncate text-[11px] {selected
                        ? 'text-muted-foreground'
                        : 'text-muted-foreground/80'}"
                    >
                      {vault.t('vault_passwords.added_date', {
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
            {vault.t('onboard_device.password_required_desc')}
          </p>

          <div class="space-y-1.5">
            <label
              for="onboard-vault-pw-label"
              class="text-xs font-medium text-foreground"
            >
              {vault.t('vault_passwords.label')}
            </label>
            <input
              id="onboard-vault-pw-label"
              type="text"
              class="flex h-9 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-hidden focus:ring-2 focus:ring-ring"
              placeholder={vault.t('vault_passwords.label_placeholder')}
              bind:value={passwordLabelInput}
              data-testid="vault-password-label"
            />
          </div>

          <div class="space-y-1.5">
            <label
              for="onboard-vault-pw"
              class="text-xs font-medium text-foreground"
            >
              {vault.t('vault.fields.password')}
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
              {vault.t('vault_passwords.confirm_password')}
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
                {vault.t('vault_passwords.working')}
              {:else}
                <ShieldCheck class="size-3.5" />
                {vault.t('vault_passwords.add_password')}
              {/if}
            </Button>
          </div>
        </form>
      {/if}
    </SetupWizardStep>

    <SetupWizardStep
      stepNumber={2}
      title={vault.t('onboard_device.wizard_sync_step')}
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
            {vault.t('onboarding.back_to_saved')}
          </button>

          {#if showSetup}
            {#if setupType === 'oauth-file'}
              <OAuthProviderSetupWizard
                {vault}
                bind:githubRepo
                idPrefix="onboard"
                preset={vault.oauthFile?.preset ??
                  vault.oauthSetupPreset ??
                  'google-drive'}
                {isVerifying}
                {isInitializing}
                {onCancelSetup}
                onConnect={onConnectProvider}
              />
            {:else if setupType === 'github'}
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
            {:else if setupType === 'local-folder'}
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
          {vault.t('onboard_device.wizard_sync_empty_desc')}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="add-provider-btn"
          onclick={() => onBeginAddProvider?.()}
        >
          <Plus class="size-4" />
          {vault.t('settings.add_sync_provider')}
        </Button>
      {:else}
        <div
          class="space-y-1.5"
          role="radiogroup"
          aria-label={vault.t('onboard_device.sync_provider')}
          data-testid="onboard-provider-list"
        >
          {#each syncProviders as provider (provider.id)}
            {@const selected = provider.id === effectiveProviderId}
            <button
              type="button"
              role="radio"
              aria-checked={selected}
              class="flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-all {selected
                ? 'border-primary/35 bg-primary/[0.08] text-foreground shadow-sm ring-1 ring-inset ring-primary/35'
                : 'border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground'}"
              data-testid="onboard-provider-{provider.id}"
              disabled={isBusy || isGenerating}
              onclick={() => {
                providerId = provider.id
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
              {#if provider.type === 'github'}
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
                  class="truncate font-mono text-[11px] {selected
                    ? 'text-muted-foreground'
                    : 'text-muted-foreground/80'}"
                  data-testid="onboard-provider-detail-{provider.id}"
                >
                  {providerStorageDetail(provider, vault.t)}
                </div>
              </div>
            </button>
          {/each}
        </div>

        <div class="flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="onboard-add-another-provider-btn"
            onclick={() => onBeginAddProvider?.()}
          >
            <Plus class="size-4" />
            {vault.t('settings.add_sync_provider')}
          </Button>
        </div>
      {/if}
    </SetupWizardStep>

    <SetupWizardStep
      stepNumber={3}
      title={vault.t('onboard_device.wizard_generate_step')}
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
        {#if selectedPassword}
          <div
            class="rounded-lg border border-border bg-muted/20 px-3 py-2.5"
            data-testid="onboard-password-selected-summary"
          >
            <p class="text-xs font-medium text-muted-foreground">
              {vault.t('onboard_device.vault_password')}
            </p>
            <p class="truncate text-sm font-medium text-foreground">
              {selectedPassword.label}
            </p>
          </div>
        {/if}

        <div class="space-y-1.5">
          <label
            for="onboard-password"
            class="text-xs font-medium text-foreground"
          >
            {selectedPassword
              ? vault.t('vault_passwords.password_for', {
                  label: selectedPassword.label,
                })
              : vault.t('vault_passwords.confirm_password')}
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
              {vault.t('onboard_device.generating')}
            {:else}
              <QrCode class="size-4" />
              {vault.t('onboard_device.title')}
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
        {vault.t('onboard_device.generating_qr')}
      </p>
    </div>
  {/if}

  {#if enrollmentCode}
    <EnrollmentOnboardResult
      {vault}
      {enrollmentLink}
      instruction={vault.t('onboard_device.ready_desc')}
      issuedSuffix={issuedAt
        ? vault.t('onboard_device.issued_time', {
            time: issuedAt.slice(0, 19).replace('T', ' ') + ' UTC',
          })
        : ''}
      linkTitle={vault.t('onboard_device.link_title')}
      linkDescription={vault.t('onboard_device.link_desc')}
      passwordReminder={vault.t('onboard_device.share_password')}
    />
  {/if}
</section>
