<!--
The invite stage of adding a device. Before the invite exists: the sync
providers the invite carries, every one ticked, each with the key the new
device gets as a row of chips (or the account a shared provider names), the
one-time passphrase, and one button; no prose. After: the QR code beside three numbered steps,
the passphrase in large type, and Done underneath: the new device joins by
itself, so nothing here waits for it.
-->
<script lang="ts">
  import { DeviceJoinMounts } from '$lib/components/add-device/device-join-mounts'
  import type { EnrollmentCodeIssueResult } from '$lib/vault/enrollment-issue-failure'
  import type { EnrollmentCodeIssueRequest } from '$lib/vault/password-enrollment-issue'
  import {
    InviteChoiceShapeKind,
    InviteProviderChoiceKind,
    InviteProviderChoices,
    type InviteKeyOption,
    type InviteProviderChoice,
  } from '$lib/vault/invite-provider-choice'
  import type { EnrollmentCredentialChoice } from '$app-wasm'

  import { untrack, type Snippet } from 'svelte'
  import { I18N_KEYS } from '../../../generated/i18n-keys'
  import {
    Ban,
    Check,
    Cloud,
    Copy,
    KeyRound,
    Plus,
    QrCode,
    RefreshCw,
  } from '@lucide/svelte'
  import EnrollmentQrCode from '$lib/components/EnrollmentQrCode.svelte'
  import SentinelOnboardingGuidance from '$lib/components/onboard-device/SentinelOnboardingGuidance.svelte'
  import { Button } from '$lib/components/ui/button'
  import { enrollmentBrowser } from '$lib/enrollment/code'
  import AuthorizedAccountsPanel from '$lib/components/AuthorizedAccountsPanel.svelte'
  import {
    localizeProviderLabel,
    localizedProviderStorageDetail,
    type StorageProvider,
  } from '$lib/auth/providers'
  import {
    SharedProviderAccountsKind,
    SharedProviderAccountsOf,
  } from '$lib/components/shared-provider-accounts'
  import {
    SharedJoinerSelectionKind,
    SharedJoinerSelections,
    type SharedJoinerSelection,
  } from '$lib/vault/shared-joiner-selection'
  import { peek_enrollment_issued_at } from '$app-wasm'
  import type { VaultState } from '$lib/vault.svelte'
  import { VaultType } from '$lib/vault/architecture-model'

  let {
    vault,
    mounts,
    enrollmentCode,
    isBusy,
    onIssueCode,
    onClearCode,
    manualJoin,
    done,
    onManageAccounts,
    onAddS3Key,
  }: {
    vault: VaultState
    /** Remote provider rows that carry this identity's control log. */
    mounts: StorageProvider[]
    enrollmentCode: string
    isBusy: boolean
    onIssueCode: (
      args: EnrollmentCodeIssueRequest,
    ) => Promise<EnrollmentCodeIssueResult>
    onClearCode: () => void
    /** How to join without a camera, shown under the invite. */
    manualJoin: string
    /** Leaves the flow once the invite is out. */
    done: Snippet
    /** Opens the Sync page, where a provider's accounts are authorized. */
    onManageAccounts: () => void
    /** Opens the Sync page with this S3 provider's Add key form. */
    onAddS3Key: (providerId: string) => void
  } = $props()

  /** Providers left out of the invite; every other one is in it. */
  let excludedIds = $state<string[]>([])
  /** The key each GitHub or S3 provider gives the new device. */
  let credentials = $state<Record<string, EnrollmentCredentialChoice>>({})
  /** The authorized account each Google Drive or iCloud invite names. */
  let joiners = $state<Record<string, SharedJoinerSelection>>({})
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
  const invitedMounts = $derived(
    compatibleMounts.filter((provider) => !excludedIds.includes(provider.id)),
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

  function toggleProvider(providerId: string): void {
    excludedIds = excludedIds.includes(providerId)
      ? excludedIds.filter((id) => id !== providerId)
      : [...excludedIds, providerId]
  }

  function credentialOf(providerId: string): EnrollmentCredentialChoice {
    const chosen = credentials[providerId]
    return chosen ? chosen : InviteProviderChoices.INVITER
  }

  function joinerOf(providerId: string): SharedJoinerSelection {
    const picked = joiners[providerId]
    return picked ? picked : SharedJoinerSelections.NONE
  }

  type KeyPick = {
    readonly providerId: string
    readonly option: InviteKeyOption
  }

  function pickKey({ providerId, option }: KeyPick): void {
    credentials[providerId] = option.choice
  }

  /** What a chip leaving the key out means, on hover and to readers. */
  function optionHint(option: InviteKeyOption): string {
    switch (option.choice.kind) {
      case 'joinerProvides':
        return vault.t(I18N_KEYS.OnboardDeviceInviteJoinerHint)
      case 'inviter':
      case 'savedKey':
        return ''
    }
  }

  /** What the invite carries for one ticked provider. */
  function choiceOf(provider: StorageProvider): InviteProviderChoice {
    const shape = InviteProviderChoices.shapeOf(provider)
    switch (shape.kind) {
      case InviteChoiceShapeKind.SharedAccount:
        return {
          kind: InviteProviderChoiceKind.Shared,
          providerId: provider.id,
          joiner: joinerOf(provider.id),
        }
      case InviteChoiceShapeKind.S3Key:
      case InviteChoiceShapeKind.GithubToken:
      case InviteChoiceShapeKind.Fixed:
        return {
          kind: InviteProviderChoiceKind.Personal,
          providerId: provider.id,
          credential: credentialOf(provider.id),
        }
    }
  }

  /** Whether a ticked shared provider has no account picked yet. */
  function awaitsAccount(choice: InviteProviderChoice): boolean {
    switch (choice.kind) {
      case InviteProviderChoiceKind.Personal:
        return false
      case InviteProviderChoiceKind.Shared:
        return choice.joiner.kind === SharedJoinerSelectionKind.None
    }
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
    if (invitedMounts.length === 0) {
      localError = vault.t(I18N_KEYS.ErrorsCloudSyncProviderRequired)
      return
    }
    const choices = invitedMounts.map((provider) => choiceOf(provider))
    if (choices.some((choice) => awaitsAccount(choice))) {
      localError = vault.t(I18N_KEYS.OnboardDeviceSharedIdentityRequired)
      return
    }
    isGenerating = true
    try {
      const issueRequest: EnrollmentCodeIssueRequest = {
        providers: choices,
        passphrase,
      }
      const issued = await onIssueCode(issueRequest)
      if (issued.isErr()) localError = vault.t(issued.error.translationKey)
    } finally {
      isGenerating = false
    }
  }
</script>

{#snippet keyChips(
  provider: StorageProvider,
  options: readonly InviteKeyOption[],
)}
  {@const shape = InviteProviderChoices.shapeOf(provider)}
  {@const chosen = InviteProviderChoices.valueOf(credentialOf(provider.id))}
  <div
    class="flex flex-wrap items-center gap-1.5 pl-7"
    role="radiogroup"
    aria-label={vault.t(I18N_KEYS.OnboardDeviceInviteKey)}
    data-testid="onboard-key-{provider.id}"
  >
    {#each options as option (option.value)}
      {@const picked = option.value === chosen}
      <button
        type="button"
        role="radio"
        aria-checked={picked}
        title={optionHint(option)}
        class="inline-flex h-8 max-w-full items-center gap-1.5 border px-2.5 text-xs transition-colors disabled:opacity-50 {picked
          ? 'border-foreground/70 bg-background text-foreground'
          : 'border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground'}"
        data-testid="onboard-key-option-{option.value}"
        disabled={isBusy || isGenerating}
        onclick={() => {
          const pick: KeyPick = { providerId: provider.id, option }
          pickKey(pick)
        }}
      >
        {#if option.id}
          <KeyRound class="size-3.5 shrink-0" aria-hidden="true" />
          <span class="min-w-0 truncate font-mono">{option.id}</span>
          <span class="nk-tag shrink-0 text-muted-foreground"
            >{vault.t(option.labelKey)}</span
          >
        {:else}
          {#if optionHint(option)}
            <Ban class="size-3.5 shrink-0" aria-hidden="true" />
          {:else}
            <KeyRound class="size-3.5 shrink-0" aria-hidden="true" />
          {/if}
          <span>{vault.t(option.labelKey)}</span>
        {/if}
      </button>
    {/each}
    {#if shape.kind === InviteChoiceShapeKind.S3Key}
      <button
        type="button"
        class="inline-flex h-8 items-center gap-1.5 border border-dashed border-border px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-50"
        data-testid="onboard-add-key-{provider.id}"
        disabled={isBusy || isGenerating}
        onclick={() => onAddS3Key(provider.id)}
      >
        <Plus class="size-3.5" aria-hidden="true" />
        {vault.t(I18N_KEYS.OnboardDeviceInviteAddKey)}
      </button>
    {/if}
  </div>
{/snippet}

<section
  class="grid grid-cols-[minmax(0,1fr)] gap-6 animate-in fade-in duration-200"
  data-testid="onboard-device-panel"
>
  {#if !enrollmentCode}
    <header class="grid gap-1.5">
      <h2 class="text-xl font-semibold tracking-tight text-foreground">
        {vault.t(I18N_KEYS.AddDeviceInviteTitle)}
      </h2>
    </header>

    <form
      class="grid grid-cols-[minmax(0,1fr)] gap-5"
      onsubmit={(event) => {
        event.preventDefault()
        void submitOnboard()
      }}
    >
      <div class="grid grid-cols-[minmax(0,1fr)] gap-2">
        <p class="nk-label">
          {vault.t(I18N_KEYS.OnboardDeviceInviteProviders)}
        </p>
        <ul
          class="grid grid-cols-[minmax(0,1fr)] gap-1.5"
          data-testid="onboard-provider-list"
        >
          {#each compatibleMounts as provider (provider.id)}
            {@const ticked = !excludedIds.includes(provider.id)}
            {@const shape = InviteProviderChoices.shapeOf(provider)}
            <li
              class="grid grid-cols-[minmax(0,1fr)] gap-2 border px-3 py-2.5 text-sm transition-colors {ticked
                ? 'border-foreground/50 bg-accent text-foreground'
                : 'border-border text-muted-foreground'}"
            >
              <label class="flex w-full cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  class="size-4 shrink-0 accent-foreground"
                  checked={ticked}
                  data-testid="onboard-provider-{provider.id}"
                  disabled={isBusy || isGenerating}
                  onchange={() => toggleProvider(provider.id)}
                />
                <Cloud class="size-4 shrink-0 opacity-80" />
                <span class="min-w-0 flex-1">
                  <span class="block truncate font-medium"
                    >{providerLabel(provider)}</span
                  >
                  <span
                    class="block truncate text-xs text-muted-foreground"
                    data-testid="onboard-provider-detail-{provider.id}"
                  >
                    {providerDetail(provider)}
                  </span>
                </span>
              </label>
              {#if ticked}
                {#if shape.kind === InviteChoiceShapeKind.S3Key}
                  {@const options = InviteProviderChoices.s3Options(
                    shape.connection,
                  )}
                  {@render keyChips(provider, options)}
                {:else if shape.kind === InviteChoiceShapeKind.GithubToken}
                  {@render keyChips(
                    provider,
                    InviteProviderChoices.githubOptions(),
                  )}
                {:else if shape.kind === InviteChoiceShapeKind.SharedAccount}
                  {@const accounts = SharedProviderAccountsOf.row(provider)}
                  {#if accounts.kind === SharedProviderAccountsKind.Listed}
                    <AuthorizedAccountsPanel
                      {vault}
                      payload={accounts.payload}
                      shareTitle={providerLabel(provider)}
                      selectable
                      bind:selection={
                        () => joinerOf(provider.id),
                        (picked: SharedJoinerSelection) => {
                          joiners[provider.id] = picked
                        }
                      }
                      disabled={isBusy || isGenerating}
                      {onManageAccounts}
                    />
                  {/if}
                {/if}
              {/if}
            </li>
          {/each}
        </ul>
      </div>

      <div class="grid grid-cols-[minmax(0,1fr)] gap-2">
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
        <p class="font-mono text-[11px] text-muted-foreground">
          {issuedLabel()}
        </p>
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
          <span class="sr-only" data-testid="onboard-link"
            >{enrollmentLink}</span
          >
        </li>
        <li class="grid min-w-0 gap-2">
          <span class="nk-step-index">02</span>
          <p class="text-sm text-pretty text-foreground">
            {vault.t(I18N_KEYS.AddDeviceOpenPassphrase)}
          </p>
          <div
            class="flex min-w-0 items-center justify-between gap-3 border border-border bg-background px-4 py-3"
          >
            <span
              class="nk-passphrase min-w-0"
              data-testid="onboard-passphrase-display">{passphrase}</span
            >
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

    <!-- A new invite is the other action here, not a footnote. -->
    <div class="flex flex-wrap items-center gap-3">
      {@render done()}
      <Button
        type="button"
        variant="outline"
        class="h-11 px-5"
        data-testid="onboard-clear-code-btn"
        onclick={() => {
          onClearCode()
          passphrase = vault.identityControl.newPassphrase()
        }}
      >
        <RefreshCw class="size-4" />
        {vault.t(I18N_KEYS.AddDeviceNewInvite)}
      </Button>
    </div>

    <p
      class="max-w-[60ch] border-t border-border pt-4 text-xs text-pretty text-muted-foreground"
    >
      {manualJoin}
    </p>
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
