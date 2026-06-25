<script lang="ts">
  import { Check, Copy, QrCode, RefreshCw } from '@lucide/svelte'
  import QRCode from 'qrcode'
  import { Button } from '$lib/components/ui/button'
  import {
    buildEnrollmentLink,
    decodeEnrollmentPayload,
  } from '$lib/enrollment-code'
  import type { StorageProvider } from '$lib/auth-providers'
  import type { VaultPasswordEntrySummary } from '$lib/vault-password'

  let {
    providers,
    activeProviderId,
    passwordEntries,
    enrollmentCode,
    isBusy,
    onIssueCode,
    onClearCode,
  }: {
    providers: StorageProvider[]
    activeProviderId: string | null
    passwordEntries: VaultPasswordEntrySummary[]
    enrollmentCode: string
    isBusy: boolean
    onIssueCode: (
      entryId: string,
      password: string,
      providerId: string,
    ) => Promise<string | void>
    onClearCode: () => void
  } = $props()

  let providerId = $state(activeProviderId ?? providers[0]?.id ?? '')
  let passwordEntryId = $state(passwordEntries[0]?.id ?? '')
  let passwordInput = $state('')
  let localError = $state('')
  let copied = $state(false)
  let qrDataUrl = $state('')

  const selectedProvider = $derived(
    providers.find((provider) => provider.id === providerId) ?? null,
  )
  const selectedPassword = $derived(
    passwordEntries.find((entry) => entry.id === passwordEntryId) ?? null,
  )
  const enrollmentLink = $derived.by(() =>
    enrollmentCode ? buildEnrollmentLink(enrollmentCode) : '',
  )
  const issuedAt = $derived.by(() => {
    if (!enrollmentCode) return ''
    try {
      return decodeEnrollmentPayload(enrollmentCode).issued_at
    } catch {
      return ''
    }
  })

  $effect(() => {
    if (
      providerId &&
      !providers.some((provider) => provider.id === providerId)
    ) {
      providerId = providers[0]?.id ?? ''
    } else if (!providerId && providers[0]) {
      providerId = providers[0].id
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
      localError = 'Choose an auth provider.'
      return
    }
    if (!selectedPassword) {
      localError = 'Choose a vault password.'
      return
    }
    if (!passwordInput) {
      localError = 'Enter the selected vault password.'
      return
    }
    try {
      await onIssueCode(selectedPassword.id, passwordInput, selectedProvider.id)
      passwordInput = ''
    } catch (e: unknown) {
      localError =
        e instanceof Error ? e.message : 'Failed to generate onboarding QR.'
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
    <h2 class="text-base font-semibold text-foreground">Onboard Device</h2>
    <p class="text-xs text-muted-foreground text-pretty">
      Generate a QR/link with provider access and a vault password for another
      browser.
    </p>
  </div>

  <form
    class="space-y-4"
    onsubmit={(event) => {
      event.preventDefault()
      void submitOnboard()
    }}
  >
    <div class="grid gap-3 sm:grid-cols-2">
      <div class="space-y-1.5">
        <label
          for="onboard-provider"
          class="text-sm font-medium text-muted-foreground"
        >
          Auth provider
        </label>
        <select
          id="onboard-provider"
          class="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          bind:value={providerId}
          disabled={providers.length === 0}
          data-testid="onboard-provider-select"
        >
          {#each providers as provider (provider.id)}
            <option value={provider.id}>{provider.label}</option>
          {/each}
        </select>
      </div>

      <div class="space-y-1.5">
        <label
          for="onboard-password-entry"
          class="text-sm font-medium text-muted-foreground"
        >
          Vault password
        </label>
        <select
          id="onboard-password-entry"
          class="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          bind:value={passwordEntryId}
          disabled={passwordEntries.length === 0}
          data-testid="onboard-password-select"
        >
          {#each passwordEntries as entry (entry.id)}
            <option value={entry.id}>{entry.label}</option>
          {/each}
        </select>
      </div>
    </div>

    <div class="space-y-1.5">
      <label
        for="onboard-password"
        class="text-sm font-medium text-muted-foreground"
      >
        Confirm password
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
        providers.length === 0 ||
        passwordEntries.length === 0}
      data-testid="onboard-device-submit"
    >
      {#if isBusy}
        <RefreshCw class="size-4 animate-spin" />
        Generating...
      {:else}
        <QrCode class="size-4" />
        Onboard Device
      {/if}
    </Button>
  </form>

  {#if passwordEntries.length === 0}
    <p
      class="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"
    >
      Create a vault password in Settings before onboarding another device.
    </p>
  {/if}

  {#if enrollmentCode}
    <div class="space-y-3 rounded-lg border border-border bg-background p-3">
      <div class="flex items-start justify-between gap-3">
        <p class="text-xs text-muted-foreground text-pretty">
          Scan this QR with the new device to open Nook, or copy the link.
          {#if issuedAt}
            <span class="ml-1 text-muted-foreground/80">
              Issued {issuedAt.slice(0, 19).replace('T', ' ')} UTC.
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
            <Check class="size-3" /> Copied
          {:else}
            <Copy class="size-3" /> Copy
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
