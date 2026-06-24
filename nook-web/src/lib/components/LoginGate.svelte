<script lang="ts">
  import {
    Cloud,
    HardDrive,
    RefreshCw,
    ShieldCheck,
    Plus,
    ChevronLeft,
    QrCode,
    KeyRound,
    Trash2,
    UserRound,
  } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import type {
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
  import ProviderPicker from '$lib/components/ProviderPicker.svelte'
  import ProviderSetupFields from '$lib/components/ProviderSetupFields.svelte'
  import type { VaultPasswordEntrySummary } from '$lib/vault-password'

  let {
    providers,
    activeProviderId,
    setupType = $bindable(null as StorageProviderType | null),
    githubPat = $bindable(''),
    githubRepo = $bindable(DEFAULT_GITHUB_REPO),
    isVerifying,
    isInitializing,
    errorMsg,
    successMsg,
    addProviderOpen = false,
    onUnlock,
    onSelectProvider,
    onBeginAddProvider,
    onCancelAddProvider,
    onBeginSetup,
    onCancelSetup,
    onOpenHelp,
    onUseEnrollmentCode,
    onUnlockWithPassword,
    loginUnlockMode = 'unknown',
    passwordEntries = [] as VaultPasswordEntrySummary[],
    selectedPasswordEntryId = $bindable(null as string | null),
    onRemoveProvider,
    loginPasswordPrompt = false,
    onConsumeLoginPasswordPrompt,
  }: {
    providers: StorageProvider[]
    activeProviderId: string | null
    loginUnlockMode?: 'unknown' | 'keys' | 'password'
    setupType?: StorageProviderType | null
    githubPat: string
    githubRepo: string
    isVerifying: boolean
    isInitializing: boolean
    errorMsg: string
    successMsg: string
    addProviderOpen?: boolean
    onUnlock: () => void | Promise<void>
    onSelectProvider: (id: string) => void | Promise<void>
    onBeginAddProvider?: () => void
    onCancelAddProvider?: () => void
    onBeginSetup: (type: StorageProviderType) => void
    onCancelSetup: () => void
    onOpenHelp?: () => void
    onUseEnrollmentCode?: (code: string) => void | Promise<void>
    onUnlockWithPassword?: (entryId: string, password: string) => void | Promise<void>
    onRemoveProvider?: (id: string) => void | Promise<void>
    loginPasswordPrompt?: boolean
    passwordEntries?: VaultPasswordEntrySummary[]
    selectedPasswordEntryId?: string | null
    onConsumeLoginPasswordPrompt?: () => void
  } = $props()

  type UnlockMethod = 'keys' | 'password'

  let unlockMethod = $state<UnlockMethod>('keys')

  $effect(() => {
    if (loginPasswordPrompt) {
      unlockMethod = 'password'
      enrollmentCodeFormOpen = false
      if (passwordEntries.length === 1 && !selectedPasswordEntryId) {
        selectedPasswordEntryId = passwordEntries[0]!.id
      }
      onConsumeLoginPasswordPrompt?.()
    }
  })

  $effect(() => {
    if (
      unlockMethod === 'password' &&
      passwordEntries.length === 1 &&
      !selectedPasswordEntryId
    ) {
      selectedPasswordEntryId = passwordEntries[0]!.id
    }
  })

  $effect(() => {
    if (unlockMethod === 'password' && passwordEntries.length === 0) {
      unlockMethod = 'keys'
    }
  })

  function handleUnlockSubmit() {
    if (unlockMethod === 'password' && onUnlockWithPassword) {
      if (!selectedPasswordEntryId) return
      const trimmed = passwordInput.trim()
      if (!trimmed) return
      void onUnlockWithPassword(selectedPasswordEntryId, trimmed)
      return
    }
    void onUnlock()
  }

  function confirmRemoveProvider(provider: StorageProvider) {
    if (!onRemoveProvider) return
    const ok = confirm(
      `Remove "${provider.label}" from saved providers? Your vault file on storage is not deleted.`,
    )
    if (ok) {
      void onRemoveProvider(provider.id)
    }
  }

  let enrollmentCodeFormOpen = $state(false)
  let enrollmentCodeInput = $state('')
  let passwordInput = $state('')

  const hasProviders = $derived(providers.length > 0)
  const showSetup = $derived(setupType !== null)
  const showSavedProviders = $derived(
    hasProviders && !showSetup && !addProviderOpen,
  )
  const showProviderPicker = $derived(
    (!hasProviders || addProviderOpen) && !showSetup,
  )
  const isUnlocking = $derived(
    isVerifying && showSavedProviders && !showSetup,
  )
  const showEnrollmentAccess = $derived(
    Boolean(onUseEnrollmentCode) &&
      (showProviderPicker || showSavedProviders || showSetup),
  )
  const showPasswordUnlockOption = $derived(
    Boolean(onUnlockWithPassword) && passwordEntries.length > 0,
  )
  const isPasswordUnlock = $derived(
    showSavedProviders && unlockMethod === 'password' && showPasswordUnlockOption,
  )
</script>

<div
  class="w-full space-y-4 animate-in fade-in duration-300"
  data-testid="login-gate"
>
  <Card
    class="border-border bg-card/80 shadow-lg shadow-black/20 backdrop-blur-sm overflow-hidden"
  >
    <CardHeader class="border-b border-border/60 pb-4 pt-5">
      <div class="space-y-1">
        {#if addProviderOpen}
          <button
            type="button"
            class="mb-2 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            data-testid="cancel-add-provider-btn"
            onclick={() => onCancelAddProvider?.()}
          >
            <ChevronLeft class="size-3.5" />
            Back to saved providers
          </button>
        {/if}
        <CardTitle class="text-lg font-semibold tracking-tight text-foreground">
          {#if showSavedProviders && !showSetup}
            Unlock your vault
          {:else if showProviderPicker}
            Your device is the key
          {:else if showSetup}
            Connect to {setupType === 'github' ? 'GitHub' : 'this device'}
          {:else}
            Your device is the key
          {/if}
        </CardTitle>
        {#if isUnlocking}
          <CardDescription class="text-pretty"
            >Unlocking your vault…</CardDescription
          >
        {:else if showSavedProviders && !showSetup}
          <CardDescription class="text-pretty">
            Two steps: pick where your vault lives, then how to decrypt it.
            Device keys are the default unlock method.
          </CardDescription>
        {:else if showProviderPicker && addProviderOpen}
          <ul
            class="list-disc space-y-1.5 pl-4 text-sm text-muted-foreground text-pretty"
          >
            <li>Nook encrypts secrets in this browser first.</li>
            <li>
              Connect another provider — the vault file is stored on that
              account.
            </li>
          </ul>
        {:else if showSetup && setupType === 'github'}
          <CardDescription class="text-pretty">
            Sign in with a personal access token — plaintext secrets never leave
            this browser.
          </CardDescription>
        {:else if showSetup}
          <ul
            class="list-disc space-y-1.5 pl-4 text-sm text-muted-foreground text-pretty"
          >
            <li>Encrypted vault stays in browser storage on this device.</li>
            <li>No provider account or sign-in required.</li>
          </ul>
        {:else if showProviderPicker}
          <p class="text-sm font-medium text-foreground">
            No master password. Your devices unlock the vault.
          </p>
          <ul
            class="mt-2 list-disc space-y-1.5 pl-4 text-sm text-muted-foreground text-pretty"
            data-testid="login-gate-intro"
          >
            <li>Passwordless access to your secrets.</li>
            <li>Your secrets. Your storage. Your keys.</li>
            <li>A decentralized vault for your secrets.</li>
          </ul>
        {/if}
      </div>
    </CardHeader>

    <CardContent class="pt-4">
      <form
        novalidate
        onsubmit={(e) => {
          e.preventDefault()
          handleUnlockSubmit()
        }}
        class="space-y-4"
      >
        {#if showSavedProviders}
          <fieldset class="space-y-2">
            <legend class="text-xs font-medium text-foreground">
              1. Storage provider
            </legend>
            <ul class="space-y-2" data-testid="saved-providers-list">
              {#each providers as provider (provider.id)}
                <li class="flex items-stretch gap-2">
                  <button
                    type="button"
                    class="flex min-w-0 flex-1 items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors {provider.id ===
                    activeProviderId
                      ? 'border-primary/40 bg-primary/5 text-foreground'
                      : 'border-border bg-muted/30 text-muted-foreground hover:bg-accent hover:text-foreground'}"
                    data-testid="saved-provider-{provider.type}"
                    disabled={isVerifying || isInitializing}
                    aria-busy={isVerifying && provider.id === activeProviderId}
                    onclick={() => void onSelectProvider(provider.id)}
                  >
                    {#if provider.type === 'github'}
                      <Cloud class="size-4 shrink-0" />
                    {:else}
                      <HardDrive class="size-4 shrink-0" />
                    {/if}
                    <span class="min-w-0 flex-1 truncate font-medium">
                      {provider.label}
                    </span>
                    {#if provider.type === 'github'}
                      <span
                        class="shrink-0 font-mono text-[10px] text-muted-foreground"
                      >
                        {provider.githubRepo ?? DEFAULT_GITHUB_REPO}
                      </span>
                    {/if}
                    {#if provider.id === activeProviderId}
                      {#if isUnlocking}
                        <RefreshCw class="size-3.5 shrink-0 animate-spin" />
                        <span class="sr-only">Unlocking</span>
                      {:else}
                        <span
                          class="shrink-0 text-[10px] font-medium uppercase tracking-wide text-primary"
                          >Last used</span
                        >
                      {/if}
                    {/if}
                  </button>
                  {#if onRemoveProvider}
                    <button
                      type="button"
                      class="inline-flex shrink-0 items-center justify-center rounded-lg border border-border bg-background px-2.5 text-muted-foreground transition-colors hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                      aria-label="Remove {provider.label}"
                      data-testid="remove-provider-{provider.id}"
                      disabled={isVerifying || isInitializing}
                      onclick={() => confirmRemoveProvider(provider)}
                    >
                      <Trash2 class="size-3.5" />
                    </button>
                  {/if}
                </li>
              {/each}
            </ul>
          </fieldset>

          <fieldset class="space-y-3" data-testid="login-unlock-method-fieldset">
            <legend class="text-xs font-medium text-foreground">
              2. Unlock with
            </legend>
            <div
              class="flex flex-wrap gap-2"
              role="radiogroup"
              aria-label="Unlock method"
            >
              <button
                type="button"
                role="radio"
                aria-checked={unlockMethod === 'keys'}
                class="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors {unlockMethod ===
                'keys'
                  ? 'border-primary/40 bg-primary/5 text-foreground'
                  : 'border-border bg-muted/30 text-muted-foreground hover:bg-accent hover:text-foreground'}"
                data-testid="login-unlock-method-keys"
                disabled={isVerifying || isInitializing}
                onclick={() => {
                  unlockMethod = 'keys'
                  passwordInput = ''
                }}
              >
                <ShieldCheck class="size-4 shrink-0" />
                This device's keys
              </button>
              {#if showPasswordUnlockOption}
                <button
                  type="button"
                  role="radio"
                  aria-checked={unlockMethod === 'password'}
                  class="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors {unlockMethod ===
                  'password'
                    ? 'border-primary/40 bg-primary/5 text-foreground'
                    : 'border-border bg-muted/30 text-muted-foreground hover:bg-accent hover:text-foreground'}"
                  data-testid="login-unlock-method-password"
                  disabled={isVerifying || isInitializing}
                  onclick={() => {
                    unlockMethod = 'password'
                  }}
                >
                  <KeyRound class="size-4 shrink-0" />
                  Backup password
                </button>
              {/if}
            </div>

            {#if isPasswordUnlock}
              <div class="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-3">
                <p class="text-xs text-muted-foreground text-pretty">
                  Pick a labelled password entry, then enter its password.
                </p>
                <ul class="space-y-2" data-testid="login-password-entry-list">
                  {#each passwordEntries as entry (entry.id)}
                    <li>
                      <button
                        type="button"
                        class="flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors {selectedPasswordEntryId ===
                        entry.id
                          ? 'border-primary/40 bg-primary/5 text-foreground'
                          : 'border-border bg-muted/30 text-muted-foreground hover:bg-accent hover:text-foreground'}"
                        data-testid="login-password-entry-{entry.id}"
                        onclick={() => {
                          selectedPasswordEntryId = entry.id
                        }}
                      >
                        <UserRound class="size-4 shrink-0 text-primary" />
                        <span class="truncate font-medium">{entry.label}</span>
                      </button>
                    </li>
                  {/each}
                </ul>
                <input
                  type="password"
                  class="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="Password for selected entry"
                  bind:value={passwordInput}
                  autocomplete="current-password"
                  data-testid="login-password-input"
                  required
                />
              </div>
            {/if}
          </fieldset>

          <div class="flex flex-wrap items-center gap-2">
            <Button
              type="submit"
              class="sm:min-w-[160px]"
              data-testid="unlock-vault-btn"
              disabled={isVerifying ||
                isInitializing ||
                !activeProviderId ||
                (isPasswordUnlock &&
                  (!selectedPasswordEntryId || !passwordInput.trim()))}
            >
              {#if isUnlocking}
                <RefreshCw class="size-4 animate-spin" />
                Unlocking…
              {:else}
                <ShieldCheck class="size-4" />
                Unlock vault
              {/if}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              class="border-border"
              data-testid="add-provider-btn"
              onclick={() => onBeginAddProvider?.()}
            >
              <Plus class="size-3.5" />
              Add provider
            </Button>
          </div>
        {:else if showProviderPicker}
          <ProviderPicker onSelect={onBeginSetup} />
        {:else if setupType}
          <ProviderSetupFields
            {setupType}
            bind:githubPat
            bind:githubRepo
            idPrefix="login"
            {onCancelSetup}
          />
        {/if}

        {#if errorMsg}
          <div
            class="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            role="alert"
            data-testid="connect-error"
          >
            {errorMsg}
          </div>
        {/if}

        {#if successMsg}
          <div
            class="rounded-lg border border-primary/20 bg-primary/10 px-4 py-3 text-sm text-primary"
            role="status"
            data-testid="connect-success"
          >
            {successMsg}
          </div>
        {/if}

        {#if showSetup}
          <div class="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              type="submit"
              class="sm:min-w-[180px]"
              data-testid="connect-provider-btn"
            >
              {#if isInitializing}
                <RefreshCw class="size-4 animate-spin" />
                Loading engine…
              {:else if isVerifying}
                <RefreshCw class="size-4 animate-spin" />
                Connecting…
              {:else}
                <ShieldCheck class="size-4" />
                Connect
              {/if}
            </Button>
          </div>
        {/if}
      </form>
    </CardContent>
  </Card>

  {#if showEnrollmentAccess}
    <Card
      class="border-border bg-card/80 shadow-lg shadow-black/20 backdrop-blur-sm overflow-hidden"
      data-testid="enrollment-login-panel"
    >
      <CardHeader class="border-b border-border/60 pb-4 pt-5">
        <div class="space-y-1">
          <CardTitle
            class="text-lg font-semibold tracking-tight text-foreground inline-flex items-center gap-2"
          >
            <QrCode class="size-4 text-primary" />
            Join from another device
          </CardTitle>
          <CardDescription class="text-pretty">
            Scan a QR code or paste an enrollment link from a device that is
            already unlocked. Provider credentials travel inside the code.
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent class="pt-4">
        {#if !enrollmentCodeFormOpen}
          <button
            type="button"
            class="flex w-full items-start gap-3 text-left transition-colors hover:opacity-90"
            data-testid="open-enrollment-code-btn"
            onclick={() => {
              enrollmentCodeFormOpen = true
            }}
          >
            <QrCode class="mt-0.5 size-4 shrink-0 text-primary" />
            <span class="min-w-0 flex-1 space-y-1">
              <span class="block text-sm font-semibold text-foreground">
                Enroll with QR or code
              </span>
              <span class="block text-xs text-muted-foreground text-pretty">
                Adds this browser as a trusted device — no approval round-trip.
              </span>
            </span>
          </button>
        {:else if onUseEnrollmentCode}
          <form
            class="space-y-4"
            onsubmit={(e) => {
              e.preventDefault()
              if (!onUseEnrollmentCode) return
              const trimmed = enrollmentCodeInput.trim()
              if (!trimmed) return
              void onUseEnrollmentCode(trimmed)
            }}
          >
            <div class="flex items-start justify-between gap-3">
              <div class="space-y-1">
                <h3 class="text-sm font-semibold text-foreground">
                  Paste enrollment link or code
                </h3>
                <p class="text-xs text-muted-foreground text-pretty">
                  Provider credentials and vault password are unpacked locally.
                </p>
              </div>
              <button
                type="button"
                class="shrink-0 text-xs font-medium text-muted-foreground hover:text-foreground"
                onclick={() => {
                  enrollmentCodeFormOpen = false
                  enrollmentCodeInput = ''
                }}
              >
                Back
              </button>
            </div>
            <textarea
              rows="4"
              class="w-full font-mono text-xs leading-relaxed rounded-md border border-border bg-background p-3 focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Paste enrollment link or code here…"
              bind:value={enrollmentCodeInput}
              data-testid="enrollment-code-input"></textarea>
            <div class="flex justify-end">
              <Button
                type="submit"
                disabled={isVerifying || !enrollmentCodeInput.trim()}
                data-testid="submit-enrollment-code-btn"
              >
                {#if isVerifying}
                  <RefreshCw class="size-4 animate-spin" /> Enrolling…
                {:else}
                  <ShieldCheck class="size-4" /> Enroll this device
                {/if}
              </Button>
            </div>
          </form>
        {/if}
      </CardContent>
    </Card>
  {/if}
  {#if showProviderPicker && !addProviderOpen && onOpenHelp}
    <ProductIntro {onOpenHelp} />
  {/if}
</div>
