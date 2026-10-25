<!--
The invite stage of adding a device. Before the invite exists: the mount
the new device joins through and its one-time passphrase, both chosen
already, and one button. After: the QR code beside three numbered steps,
the passphrase in large type, and Done underneath: the new device joins by
itself, so nothing here waits for it.
-->
<script lang="ts">
  import { DeviceJoinMounts } from '$lib/components/add-device/device-join-mounts'
  import type { EnrollmentCodeIssueResult } from '$lib/vault/enrollment-issue-failure'
  type IdentityCodeIssue = {
    readonly providerId: string
    readonly passphrase: string
  }

  import { untrack, type Snippet } from 'svelte'
  import { I18N_KEYS } from '../../../generated/i18n-keys'
  import { Check, Cloud, Copy, QrCode, RefreshCw } from '@lucide/svelte'
  import EnrollmentQrCode from '$lib/components/EnrollmentQrCode.svelte'
  import SentinelOnboardingGuidance from '$lib/components/onboard-device/SentinelOnboardingGuidance.svelte'
  import { Button } from '$lib/components/ui/button'
  import { enrollmentBrowser } from '$lib/enrollment/code'
  import AuthorizedAccountsPanel from '$lib/components/AuthorizedAccountsPanel.svelte'
  import {
    StoredOAuthFileConfigurationDecodeKind,
    decodeStoredOAuthFileConfiguration,
    localizeProviderLabel,
    localizedProviderStorageDetail,
    type StorageProvider,
  } from '$lib/auth/providers'
  import { peek_enrollment_issued_at } from '$app-wasm'
  import type { VaultState } from '$lib/vault.svelte'
  import {
    OnboardingType,
    VaultType,
    provider_onboarding_type,
  } from '$lib/vault/architecture-model'

  let {
    vault,
    mounts,
    enrollmentCode,
    isBusy,
    onIssueCode,
    onClearCode,
    manualJoin,
    done,
  }: {
    vault: VaultState
    /** Remote provider rows that carry this identity's control log. */
    mounts: StorageProvider[]
    enrollmentCode: string
    isBusy: boolean
    onIssueCode: (args: IdentityCodeIssue) => Promise<EnrollmentCodeIssueResult>
    onClearCode: () => void
    /** How to join without a camera, shown under the invite. */
    manualJoin: string
    /** Leaves the flow once the invite is out. */
    done: Snippet
  } = $props()

  let chosenProviderId = $state('')
  let passphrase = $state(untrack(() => vault.identityControl.newPassphrase()))
  let localError = $state('')
  let isGenerating = $state(false)
  let linkCopied = $state(false)
  let passphraseCopied = $state(false)

  const compatibleMounts = $derived.by(() => {
    const mountRequest: ConstructorParameters<typeof DeviceJoinMounts>[0] = {
      mounts,
      replication: vault.vaultArchitecture.replication_type,
    }
    return new DeviceJoinMounts(mountRequest).compatible
  })
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
  // Google Drive and iCloud invites name one of the provider's authorized
  // accounts, picked from the provider's own sharing list.
  const sharedProviderConfig = $derived.by(() => {
    if (!usesSharedGrant || selectedProvider === false) return false
    const decoded = decodeStoredOAuthFileConfiguration(
      selectedProvider.oauthFile,
    )
    return decoded.kind === StoredOAuthFileConfigurationDecodeKind.Configured
      ? decoded.config
      : false
  })
  const sharedProviderTitle = $derived(
    selectedProvider === false ? '' : providerLabel(selectedProvider),
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

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(enrollmentLink)
      linkCopied = true
      window.setTimeout(() => (linkCopied = false), 1500)
    } catch {
      // Copying is a convenience; the link stays selectable.
    }
  }

  async function copyPassphrase() {
    try {
      await navigator.clipboard.writeText(passphrase)
      passphraseCopied = true
      window.setTimeout(() => (passphraseCopied = false), 1500)
    } catch {
      // Copying is a convenience; the passphrase stays on screen.
    }
  }

  function issuedLabel(): string {
    const issuedArgs: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.OnboardDeviceIssuedTime,
      replacements: { time: issuedAt.slice(0, 19).replace('T', ' ') + ' UTC' },
    }
    return vault.t(issuedArgs)
  }

  async function submitOnboard() {
    localError = ''
    onClearCode()
    if (selectedProvider === false) {
      localError = vault.t(I18N_KEYS.IdentityControlErrorProviderNotMount)
      return
    }
    if (usesSharedGrant && !vault.sharedJoinerIdentity.trim()) {
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
  class="grid gap-6 animate-in fade-in duration-200"
  data-testid="onboard-device-panel"
>
  {#if !enrollmentCode}
    <header class="grid gap-1.5">
      <h2 class="text-xl font-semibold tracking-tight text-foreground">
        {vault.t(I18N_KEYS.AddDeviceInviteTitle)}
      </h2>
      <p class="max-w-[56ch] text-sm text-pretty text-muted-foreground">
        {vault.t(I18N_KEYS.AddDeviceInviteBody)}
      </p>
    </header>

    <form
      class="grid gap-5"
      onsubmit={(event) => {
        event.preventDefault()
        void submitOnboard()
      }}
    >
      <div class="grid gap-2">
        <p class="nk-label">{vault.t(I18N_KEYS.IdentityControlOnboardProvider)}</p>
        <div
          class="grid gap-1.5"
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
              class="flex w-full items-center gap-3 border px-3 py-2.5 text-left text-sm transition-colors {selected
                ? 'border-foreground/50 bg-accent text-foreground'
                : 'border-border text-muted-foreground hover:bg-accent/60 hover:text-foreground'}"
              data-testid="onboard-provider-{provider.id}"
              disabled={isBusy || isGenerating}
              onclick={() => (chosenProviderId = provider.id)}
            >
              <span
                class="inline-flex size-[18px] shrink-0 items-center justify-center rounded-full border-2 {selected
                  ? 'border-foreground'
                  : 'border-muted-foreground/35'}"
                aria-hidden="true"
              >
                {#if selected}
                  <span class="size-2 rounded-full bg-foreground"></span>
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

      <div class="grid gap-2">
        <label for="onboard-passphrase" class="nk-label">
          {vault.t(I18N_KEYS.AddDevicePassphraseLabel)}
        </label>
        <div
          class="flex items-stretch border border-border bg-background focus-within:ring-2 focus-within:ring-ring"
        >
          <input
            id="onboard-passphrase"
            class="nk-passphrase min-w-0 flex-1 bg-transparent px-4 py-3 outline-none"
            bind:value={passphrase}
            autocomplete="off"
            spellcheck="false"
            disabled={isBusy || isGenerating}
            data-testid="onboard-passphrase-input"
          />
          <button
            type="button"
            class="grid w-12 shrink-0 place-items-center border-l border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            disabled={isBusy || isGenerating}
            data-testid="onboard-new-passphrase-btn"
            aria-label={vault.t(I18N_KEYS.AddDeviceRegenerate)}
            title={vault.t(I18N_KEYS.AddDeviceRegenerate)}
            onclick={() => (passphrase = vault.identityControl.newPassphrase())}
          >
            <RefreshCw class="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {#if usesSharedGrant && sharedProviderConfig !== false}
        <AuthorizedAccountsPanel
          {vault}
          config={sharedProviderConfig}
          shareTitle={sharedProviderTitle}
          selectable
          bind:selectedEmail={vault.sharedJoinerIdentity}
          disabled={isBusy || isGenerating}
        />
      {/if}

      {#if localError}
        <p class="text-xs text-destructive" data-testid="onboard-error">
          {localError}
        </p>
      {/if}

      <div class="flex flex-wrap items-center gap-x-6 gap-y-3">
        <Button
          type="submit"
          class="nk-go h-11 px-5"
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
        <details
          class="text-xs text-muted-foreground"
          data-testid="onboarding-type-summary"
        >
          <summary class="cursor-pointer select-none hover:text-foreground">
            {vault.t(I18N_KEYS.AddDeviceHowItWorks)}
          </summary>
          <div class="mt-2 max-w-[48ch] border-l-2 border-border pl-3">
            <p class="font-medium text-foreground" data-testid="onboarding-type-label">
              {vault.t(onboardingTypeTitleKey)}
            </p>
            <p class="mt-1 text-pretty" data-testid="onboarding-type-description">
              {vault.t(onboardingTypeDescriptionKey)}
            </p>
          </div>
        </details>
      </div>
    </form>

    {#if isGenerating}
      <div
        class="flex items-center gap-3 border border-border p-4"
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
    <header class="grid gap-1.5">
      <h2 class="text-xl font-semibold tracking-tight text-foreground">
        {vault.t(I18N_KEYS.AddDeviceOpenTitle)}
      </h2>
      {#if issuedAt}
        <p class="font-mono text-[11px] text-muted-foreground">{issuedLabel()}</p>
      {/if}
    </header>

    <div
      class="grid gap-8 md:grid-cols-[auto_minmax(0,1fr)] md:items-start"
      data-testid="onboard-enrollment-result"
    >
      <div class="justify-self-center p-2">
        <div class="nk-qr-frame">
          <EnrollmentQrCode
            {enrollmentLink}
            loadingLabel={vault.t(I18N_KEYS.OnboardDeviceGeneratingQr)}
          />
        </div>
      </div>

      <ol class="grid min-w-0 gap-6">
        <li class="grid min-w-0 gap-2">
          <span class="nk-step-index">01</span>
          <p class="text-sm text-pretty text-foreground">
            {vault.t(I18N_KEYS.AddDeviceOpenScan)}
          </p>
          <div class="flex min-w-0 items-stretch border border-border">
            <input
              type="text"
              readonly
              value={enrollmentLink}
              aria-label={vault.t(I18N_KEYS.OnboardDeviceLinkTitle)}
              data-testid="onboarding-link-url"
              class="min-w-0 flex-1 bg-transparent px-3 py-2 font-mono text-xs text-muted-foreground outline-none"
              onclick={(event) => event.currentTarget.select()}
            />
            <button
              type="button"
              class="flex shrink-0 items-center gap-1.5 border-l border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent"
              data-testid="copy-onboard-link-btn"
              onclick={() => void copyLink()}
            >
              {#if linkCopied}
                <Check class="size-3.5" aria-hidden="true" />
                {vault.t(I18N_KEYS.OnboardDeviceCopiedLink)}
              {:else}
                <Copy class="size-3.5" aria-hidden="true" />
                {vault.t(I18N_KEYS.OnboardDeviceCopyLink)}
              {/if}
            </button>
          </div>
          <span class="sr-only" data-testid="onboard-link">{enrollmentLink}</span>
        </li>
        <li class="grid min-w-0 gap-2">
          <span class="nk-step-index">02</span>
          <p class="text-sm text-pretty text-foreground">
            {vault.t(I18N_KEYS.AddDeviceOpenPassphrase)}
          </p>
          <div
            class="flex min-w-0 items-center justify-between gap-3 border border-border bg-background px-4 py-3"
          >
            <span class="nk-passphrase min-w-0" data-testid="onboard-passphrase-display">{passphrase}</span>
            <button
              type="button"
              class="flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              data-testid="onboard-copy-passphrase-btn"
              onclick={() => void copyPassphrase()}
            >
              {#if passphraseCopied}
                <Check class="size-3.5" aria-hidden="true" />
                {vault.t(I18N_KEYS.AddDeviceCopied)}
              {:else}
                <Copy class="size-3.5" aria-hidden="true" />
                {vault.t(I18N_KEYS.AddDeviceCopy)}
              {/if}
            </button>
          </div>
        </li>
        <li class="grid min-w-0 gap-2">
          <span class="nk-step-index">03</span>
          <p class="text-sm text-pretty text-foreground">
            {vault.t(I18N_KEYS.AddDeviceOpenJoin)}
          </p>
        </li>
      </ol>
    </div>

    {#if vault.sharedGrantInstructions}
      <div
        class="nk-banner nk-banner-warning p-3 text-sm text-foreground"
        data-testid="shared-grant-instructions"
      >
        {vault.sharedGrantInstructions}
      </div>
    {/if}

    {@render done()}

    <footer
      class="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-border pt-4 text-xs text-muted-foreground"
    >
      <span class="max-w-[60ch] text-pretty">{manualJoin}</span>
      <button
        type="button"
        class="underline decoration-muted-foreground/40 underline-offset-4 hover:text-foreground"
        data-testid="onboard-clear-code-btn"
        onclick={() => {
          onClearCode()
          passphrase = vault.identityControl.newPassphrase()
        }}
      >
        {vault.t(I18N_KEYS.AddDeviceNewInvite)}
      </button>
    </footer>
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
