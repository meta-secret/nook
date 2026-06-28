<script lang="ts">
  import {
    Check,
    ChevronDown,
    Cloud,
    Copy,
    HardDrive,
    QrCode,
    RefreshCw,
  } from '@lucide/svelte'
  import QRCode from 'qrcode'
  import { Button } from '$lib/components/ui/button'
  import {
    buildEnrollmentLink,
    peekEnrollmentIssuedAt,
  } from '$lib/enrollment-code'
  import {
    localizeProviderLabel,
    providerStorageDetail,
    type StorageProvider,
  } from '$lib/auth-providers'
  import type { VaultPasswordEntrySummary } from '$lib/vault-password'
  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    syncProviders,
    passwordEntries,
    enrollmentCode,
    isBusy,
    onIssueCode,
    onClearCode,
    onOpenStorageSettings,
    onOpenPasswordSettings,
  }: {
    vault: VaultState
    syncProviders: StorageProvider[]
    passwordEntries: VaultPasswordEntrySummary[]
    enrollmentCode: string
    isBusy: boolean
    onIssueCode: (
      entryId: string,
      password: string,
      providerId: string,
    ) => Promise<string | void>
    onClearCode: () => void
    onOpenStorageSettings?: () => void
    onOpenPasswordSettings?: () => void
  } = $props()

  let providerId = $state(syncProviders[0]?.id ?? '')
  let passwordEntryId = $state(passwordEntries[0]?.id ?? '')
  let passwordInput = $state('')
  let localError = $state('')
  let copied = $state(false)
  let qrDataUrl = $state('')

  const selectedProvider = $derived(
    syncProviders.find((provider) => provider.id === providerId) ?? null,
  )
  const selectedPassword = $derived(
    passwordEntries.find((entry) => entry.id === passwordEntryId) ?? null,
  )
  const enrollmentLink = $derived.by(() =>
    enrollmentCode ? buildEnrollmentLink(enrollmentCode) : '',
  )
  const issuedAt = $derived.by(() => {
    if (!enrollmentCode) return ''
    return peekEnrollmentIssuedAt(enrollmentCode) ?? ''
  })

  $effect(() => {
    if (
      providerId &&
      !syncProviders.some((provider) => provider.id === providerId)
    ) {
      providerId = syncProviders[0]?.id ?? ''
    } else if (!providerId && syncProviders[0]) {
      providerId = syncProviders[0].id
    }
  })

  $effect(() => {
    if (
      passwordEntryId &&
      !passwordEntries.some((entry) => entry.id === passwordEntryId)
    ) {
      passwordEntryId = passwordEntries[0]?.id ?? ''
    } else if (!passwordEntryId && passwordEntries[0]) {
      passwordEntryId = passwordEntries[0].id
    }
  })

  $effect(() => {
    void enrollmentCode
    if (!enrollmentCode) {
      qrDataUrl = ''
      return
    }
    QRCode.toDataURL(enrollmentLink, {
      errorCorrectionLevel: 'H',
      margin: 1,
      width: 240,
      color: { dark: '#111317', light: '#ffffff' },
    })
      .then((url: string) => {
        qrDataUrl = url
      })
      .catch(() => {
        qrDataUrl = ''
      })
  })

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
    try {
      await onIssueCode(selectedPassword.id, passwordInput, selectedProvider.id)
      passwordInput = ''
    } catch (e: unknown) {
      localError =
        e instanceof Error ? e.message : vault.t('onboard_device.failed_qr_err')
    }
  }

  async function copyLink() {
    if (!enrollmentLink) return
    try {
      await navigator.clipboard.writeText(enrollmentLink)
      copied = true
      setTimeout(() => {
        copied = false
      }, 1500)
    } catch {
      // best effort
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

  <form
    class="space-y-4"
    onsubmit={(event) => {
      event.preventDefault()
      void submitOnboard()
    }}
  >
    <div class="space-y-4">
      <div class="space-y-1.5">
        <div class="flex items-baseline justify-between gap-2">
          <p
            id="onboard-provider-label"
            class="text-sm font-medium text-muted-foreground"
          >
            {vault.t('onboard_device.sync_provider')}
          </p>
          {#if onOpenStorageSettings}
            <button
              type="button"
              class="shrink-0 text-xs font-medium text-primary hover:underline"
              data-testid="onboard-open-storage-settings"
              onclick={() => onOpenStorageSettings()}
            >
              {vault.t('onboard_device.add_in_settings')}
            </button>
          {/if}
        </div>
        {#if syncProviders.length === 0}
          <p class="text-xs text-muted-foreground">
            {vault.t('onboard_device.no_sync_providers')}
            {#if onOpenStorageSettings}
              <button
                type="button"
                class="font-medium text-primary hover:underline"
                data-testid="onboard-empty-providers-settings-link"
                onclick={() => onOpenStorageSettings()}
              >
                {vault.t('onboard_device.add_one_in_settings')}
              </button>
            {/if}
          </p>
        {:else}
          <div
            class="space-y-1.5"
            role="radiogroup"
            aria-labelledby="onboard-provider-label"
            data-testid="onboard-provider-list"
          >
            {#each syncProviders as provider (provider.id)}
              {@const selected = provider.id === providerId}
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                class="flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-all {selected
                  ? 'border-primary/35 bg-primary/[0.08] text-foreground shadow-sm ring-1 ring-inset ring-primary/35'
                  : 'border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground'}"
                data-testid="onboard-provider-{provider.id}"
                disabled={isBusy}
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
        {/if}
      </div>

      <div class="space-y-1.5">
        <div class="flex items-baseline justify-between gap-2">
          <label
            for="onboard-password-entry"
            class="text-sm font-medium text-muted-foreground"
          >
            {vault.t('onboard_device.vault_password')}
          </label>
          {#if onOpenPasswordSettings}
            <button
              type="button"
              class="shrink-0 text-xs font-medium text-primary hover:underline"
              data-testid="onboard-open-password-settings"
              onclick={() => onOpenPasswordSettings()}
            >
              {vault.t('onboard_device.add_in_settings')}
            </button>
          {/if}
        </div>
        <div class="relative">
          <select
            id="onboard-password-entry"
            class="h-10 w-full appearance-none rounded-lg border border-border bg-background pl-3 pr-10 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            bind:value={passwordEntryId}
            disabled={passwordEntries.length === 0}
            data-testid="onboard-password-select"
          >
            {#each passwordEntries as entry (entry.id)}
              <option value={entry.id}>{entry.label}</option>
            {/each}
          </select>
          <ChevronDown
            class="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
        </div>
      </div>
    </div>

    <div class="space-y-1.5">
      <label
        for="onboard-password"
        class="text-sm font-medium text-muted-foreground"
      >
        {vault.t('vault_passwords.confirm_password')}
      </label>
      <input
        id="onboard-password"
        type="password"
        class="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        bind:value={passwordInput}
        autocomplete="current-password"
        data-testid="onboard-password-input"
      />
    </div>

    {#if localError}
      <p class="text-xs text-destructive" data-testid="onboard-error">
        {localError}
      </p>
    {/if}

    <Button
      type="submit"
      disabled={isBusy ||
        syncProviders.length === 0 ||
        passwordEntries.length === 0}
      data-testid="onboard-device-submit"
    >
      {#if isBusy}
        <RefreshCw class="size-4 animate-spin" />
        {vault.t('onboard_device.generating')}
      {:else}
        <QrCode class="size-4" />
        {vault.t('onboard_device.title')}
      {/if}
    </Button>
  </form>

  {#if passwordEntries.length === 0}
    <p
      class="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"
      data-testid="onboard-missing-password-hint"
    >
      {vault.t('onboard_device.missing_password_hint')}
      {#if onOpenPasswordSettings}
        <button
          type="button"
          class="ml-1 font-medium text-primary hover:underline"
          data-testid="onboard-missing-password-settings-link"
          onclick={() => onOpenPasswordSettings()}
        >
          {vault.t('onboard_device.missing_password_settings_link')}
        </button>
      {/if}
    </p>
  {/if}

  {#if enrollmentCode}
    <div class="space-y-3 rounded-lg border border-border bg-background p-3">
      <div class="flex items-start justify-between gap-3">
        <p class="text-xs text-muted-foreground text-pretty">
          {vault.t('onboard_device.ready_desc')}
          {#if issuedAt}
            <span class="ml-1 text-muted-foreground/80">
              {vault.t('onboard_device.issued_time', {
                time: issuedAt.slice(0, 19).replace('T', ' ') + ' UTC',
              })}
            </span>
          {/if}
        </p>
        <button
          type="button"
          class="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          onclick={copyLink}
          data-testid="copy-onboard-link-btn"
        >
          {#if copied}
            <Check class="size-3" /> {vault.t('vault.copied')}
          {:else}
            <Copy class="size-3" /> {vault.t('vault.copy')}
          {/if}
        </button>
      </div>

      {#if qrDataUrl}
        <div class="flex justify-center">
          <img
            src={qrDataUrl}
            alt="Onboarding QR"
            class="rounded-md border border-border"
            width="240"
            height="240"
          />
        </div>
      {/if}

      <span class="sr-only" data-testid="onboard-link">{enrollmentLink}</span>
      <textarea
        readonly
        rows="3"
        class="w-full font-mono text-[10px] leading-relaxed rounded-md border border-border bg-muted/30 p-2 text-muted-foreground break-all"
        data-testid="onboard-code">{enrollmentCode}</textarea
      >
    </div>
  {/if}
</section>
