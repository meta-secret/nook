<!--
Add an app to the current identity: choose the identity mount the new app
joins through, share a one-time passphrase, and create the code. A member
approves the join on the Devices page.
-->
<script lang="ts">
  import type { EnrollmentCodeIssueResult } from '$lib/vault/enrollment-issue-failure'
  type IdentityCodeIssue = {
    readonly providerId: string
    readonly passphrase: string
  }

  import { untrack } from 'svelte'
  import { I18N_KEYS } from '../../../generated/i18n-keys'
  import { Cloud, QrCode, RefreshCw, KeyRound } from '@lucide/svelte'
  import EnrollmentOnboardResult from '$lib/components/EnrollmentOnboardResult.svelte'
  import SentinelOnboardingGuidance from '$lib/components/onboard-device/SentinelOnboardingGuidance.svelte'
  import { Button } from '$lib/components/ui/button'
  import { enrollmentBrowser } from '$lib/enrollment/code'
  import {
    StorageProviderPresentation,
    localizeProviderLabel,
    localizedProviderStorageDetail,
    type StorageProvider,
  } from '$lib/auth/providers'
  import {
    peek_enrollment_issued_at,
    provider_carries_device_join,
  } from '$app-wasm'
  import type { VaultState } from '$lib/vault.svelte'
  import {
    OnboardingType,
    VaultType,
    provider_onboarding_type,
    provider_supports_replication,
  } from '$lib/vault/architecture-model'

  let {
    vault,
    mounts,
    enrollmentCode,
    isBusy,
    onIssueCode,
    onClearCode,
    onOpenSync,
  }: {
    vault: VaultState
    /** Remote provider rows that carry this identity's control log. */
    mounts: StorageProvider[]
    enrollmentCode: string
    isBusy: boolean
    onIssueCode: (args: IdentityCodeIssue) => Promise<EnrollmentCodeIssueResult>
    onClearCode: () => void
    onOpenSync: () => void
  } = $props()

  let chosenProviderId = $state('')
  let passphrase = $state(untrack(() => vault.identityControl.newPassphrase()))
  let localError = $state('')
  let isGenerating = $state(false)

  /** Cloud mounts another device can reach that replicate this vault's
   * architecture. A local folder keeps a copy but cannot carry a join. */
  const compatibleMounts = $derived(
    mounts.filter(
      (provider) =>
        provider_carries_device_join(provider) &&
        provider_supports_replication(
          provider,
          vault.vaultArchitecture.replication_type,
        ),
    ),
  )
  const selectedProvider = $derived(
    compatibleMounts.find((provider) => provider.id === chosenProviderId) ||
      compatibleMounts[0] ||
      false,
  )
  const usesSharedGrant = $derived(
    selectedProvider !== false &&
      provider_onboarding_type(selectedProvider, vault.vaultArchitecture) ===
        OnboardingType.SharedProviderGrant,
  )
  const onboardingTypeTitleKey = $derived(
    usesSharedGrant
      ? I18N_KEYS.ArchitectureModesOnboardingTypeSharedProviderGrantTitle
      : I18N_KEYS.ArchitectureModesOnboardingTypePersonalCredentialTransferTitle,
  )
  const onboardingTypeDescriptionKey = $derived(
    usesSharedGrant
      ? I18N_KEYS.ArchitectureModesOnboardingTypeSharedProviderGrantDescription
      : I18N_KEYS.ArchitectureModesOnboardingTypePersonalCredentialTransferDescription,
  )
  const requiresSharedJoinerIdentity = $derived(
    usesSharedGrant &&
      selectedProvider !== false &&
      !new StorageProviderPresentation(selectedProvider).isICloudProvider(),
  )
  const isSentinelVault = $derived(
    vault.vaultArchitecture.vault_type === VaultType.Sentinel,
  )
  const enrollmentLink = $derived.by(() => {
    if (!enrollmentCode) return ''
    const enrollmentLinkRequest: Parameters<
      typeof enrollmentBrowser.buildEnrollmentLink
    >[0] = {
      code: enrollmentCode,
      baseUrl: enrollmentBrowser.getEnrollmentLinkBase(),
    }
    return enrollmentBrowser.buildEnrollmentLink(enrollmentLinkRequest)
  })
  const issuedAt = $derived.by(() => {
    if (!enrollmentCode) return ''
    return peek_enrollment_issued_at(enrollmentCode)
  })

  function providerLabel(provider: StorageProvider): string {
    const labelRequest: Parameters<typeof localizeProviderLabel>[0] = {
      label: provider.label,
      t: vault.t,
    }
    return localizeProviderLabel(labelRequest)
  }

  function providerDetail(provider: StorageProvider): string {
    const detailRequest: Parameters<typeof localizedProviderStorageDetail>[0] =
      { provider, t: vault.t }
    return localizedProviderStorageDetail(detailRequest)
  }

  async function submitOnboard() {
    localError = ''
    onClearCode()
    if (selectedProvider === false) {
      localError = vault.t(I18N_KEYS.IdentityControlErrorProviderNotMount)
      return
    }
    if (requiresSharedJoinerIdentity && !vault.sharedJoinerIdentity.trim()) {
      localError = vault.t(I18N_KEYS.OnboardDeviceSharedIdentityRequired)
      return
    }
    isGenerating = true
    try {
      const issueRequest: IdentityCodeIssue = {
        providerId: selectedProvider.id,
        passphrase,
      }
      const issued = await onIssueCode(issueRequest)
      if (issued.isErr()) localError = vault.t(issued.error.translationKey)
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
      {vault.t(I18N_KEYS.IdentityControlOnboardTitle)}
    </h2>
    <p class="text-xs text-muted-foreground text-pretty">
      {vault.t(I18N_KEYS.IdentityControlOnboardDescription)}
    </p>
  </div>

  {#if compatibleMounts.length === 0}
    <div
      class="nk-banner nk-banner-warning flex flex-col gap-2 p-3 text-sm text-foreground sm:flex-row sm:items-center sm:justify-between"
      data-testid="onboard-no-identity-mount"
    >
      <span>{vault.t(I18N_KEYS.IdentityControlNoDeviceJoinMounts)}</span>
      <Button
        type="button"
        size="sm"
        variant="outline"
        data-testid="onboard-open-sync-btn"
        onclick={onOpenSync}
      >
        {vault.t(I18N_KEYS.IdentityControlOpenSync)}
      </Button>
    </div>
  {:else if !enrollmentCode}
    <form
      class="space-y-4"
      onsubmit={(event) => {
        event.preventDefault()
        void submitOnboard()
      }}
    >
      <div class="space-y-2">
        <p class="text-xs font-medium text-foreground">
          {vault.t(I18N_KEYS.IdentityControlOnboardProvider)}
        </p>
        <div
          class="space-y-1.5"
          role="radiogroup"
          aria-label={vault.t(I18N_KEYS.IdentityControlOnboardProvider)}
          data-testid="onboard-provider-list"
        >
          {#each compatibleMounts as provider (provider.id)}
            {@const selected =
              selectedProvider !== false && selectedProvider.id === provider.id}
            <button
              type="button"
              role="radio"
              aria-checked={selected}
              class="flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-all {selected
                ? 'border-primary/35 bg-primary/[0.08] text-foreground shadow-sm ring-1 ring-inset ring-primary/35'
                : 'border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground'}"
              data-testid="onboard-provider-{provider.id}"
              disabled={isBusy || isGenerating}
              onclick={() => (chosenProviderId = provider.id)}
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
              <Cloud class="size-4 shrink-0 opacity-80" />
              <div class="min-w-0 flex-1">
                <span class="block truncate font-medium"
                  >{providerLabel(provider)}</span
                >
                <span
                  class="block truncate text-xs text-muted-foreground"
                  data-testid="onboard-provider-detail-{provider.id}"
                >
                  {providerDetail(provider)}
                </span>
              </div>
            </button>
          {/each}
        </div>
      </div>

      <div class="space-y-2">
        <label
          for="onboard-passphrase"
          class="text-xs font-medium text-foreground"
        >
          {vault.t(I18N_KEYS.IdentityControlOnboardPassphrase)}
        </label>
        <div class="flex gap-2">
          <input
            id="onboard-passphrase"
            class="flex h-9 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground focus:outline-hidden focus:ring-2 focus:ring-ring"
            bind:value={passphrase}
            autocomplete="off"
            spellcheck="false"
            disabled={isBusy || isGenerating}
            data-testid="onboard-passphrase-input"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            class="h-9 shrink-0"
            disabled={isBusy || isGenerating}
            data-testid="onboard-new-passphrase-btn"
            onclick={() => (passphrase = vault.identityControl.newPassphrase())}
          >
            <KeyRound class="size-4" />
            {vault.t(I18N_KEYS.IdentityControlOnboardNewPassphrase)}
          </Button>
        </div>
        <p class="text-xs text-muted-foreground">
          {vault.t(I18N_KEYS.IdentityControlOnboardPassphraseHint)}
        </p>
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
        <div class="space-y-2">
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
            placeholder={vault.t(I18N_KEYS.OnboardDeviceSharedIdentityPlaceholder)}
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
            {vault.t(I18N_KEYS.IdentityControlOnboardGenerate)}
          {/if}
        </Button>
      </div>
    </form>

    {#if isGenerating}
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
  {:else}
    <EnrollmentOnboardResult
      {vault}
      {enrollmentLink}
      instruction={vault.t(I18N_KEYS.IdentityControlOnboardCodeReady)}
      issuedSuffix={issuedAt
        ? (() => {
            const issuedArgs: Parameters<typeof vault.t>[0] = {
              key: I18N_KEYS.OnboardDeviceIssuedTime,
              replacements: {
                time: issuedAt.slice(0, 19).replace('T', ' ') + ' UTC',
              },
            }
            return vault.t(issuedArgs)
          })()
        : ''}
      linkTitle={vault.t(I18N_KEYS.OnboardDeviceLinkTitle)}
      linkDescription={vault.t(I18N_KEYS.OnboardDeviceLinkDesc)}
      passwordReminder={vault.t(I18N_KEYS.IdentityControlOnboardPassphraseHint)}
    />
    <div class="space-y-1">
      <p class="text-xs font-medium text-foreground">
        {vault.t(I18N_KEYS.IdentityControlOnboardPassphrase)}
      </p>
      <p
        class="rounded-md border border-border/50 bg-muted/20 px-3 py-2 font-mono text-sm"
        data-testid="onboard-passphrase-display"
      >
        {passphrase}
      </p>
    </div>
    {#if vault.sharedGrantInstructions}
      <div
        class="nk-banner nk-banner-warning p-3 text-sm text-foreground"
        data-testid="shared-grant-instructions"
      >
        {vault.sharedGrantInstructions}
      </div>
    {/if}
    <div class="flex justify-end">
      <Button
        type="button"
        size="sm"
        variant="outline"
        data-testid="onboard-clear-code-btn"
        onclick={() => {
          onClearCode()
          passphrase = vault.identityControl.newPassphrase()
        }}
      >
        {vault.t(I18N_KEYS.IdentityControlOnboardNewPassphrase)}
      </Button>
    </div>
  {/if}

  {#if isSentinelVault}
    <SentinelOnboardingGuidance
      {vault}
      readyParticipants={((v) => (v ? v : 0))(
        vault.vaultArchitecture.sentinel_ready_participants,
      )}
      requiredParticipants={((v) => (v ? v : 0))(
        vault.vaultArchitecture.sentinel_required_participants,
      )}
      compatibleProviderCount={compatibleMounts.length}
    />
  {/if}
</section>
