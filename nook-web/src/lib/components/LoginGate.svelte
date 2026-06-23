<script lang="ts">
  import {
    Cloud,
    HardDrive,
    RefreshCw,
    ShieldCheck,
    Plus,
    ChevronLeft,
    QrCode,
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
  }: {
    providers: StorageProvider[]
    activeProviderId: string | null
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
    onUnlockWithPassword?: (password: string) => void | Promise<void>
  } = $props()

  let enrollmentCodeFormOpen = $state(false)
  let enrollmentCodeInput = $state('')
  let passwordFormOpen = $state(false)
  let passwordInput = $state('')

  const hasProviders = $derived(providers.length > 0)
  const showSetup = $derived(setupType !== null)
  const showSavedProviders = $derived(
    hasProviders && !showSetup && !addProviderOpen,
  )
  const showProviderPicker = $derived(
    (!hasProviders || addProviderOpen) && !showSetup,
  )
  const isUnlocking = $derived(isVerifying && showSavedProviders && !showSetup)
</script>

<div class="w-full animate-in fade-in duration-300" data-testid="login-gate">
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
            Choose which saved provider to decrypt and open.
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
          <ul
            class="list-disc space-y-1.5 pl-4 text-sm text-muted-foreground text-pretty"
          >
            <li>Sign in to GitHub with a personal access token.</li>
            <li>Nook syncs only the encrypted vault file to your repo.</li>
            <li>Plaintext secrets never leave this browser.</li>
          </ul>
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
          void onUnlock()
        }}
        class="space-y-4"
      >
        {#if showSavedProviders}
          <fieldset class="space-y-2">
            <legend class="text-xs font-medium text-foreground">
              Saved providers
            </legend>
            <ul class="space-y-2" data-testid="saved-providers-list">
              {#each providers as provider (provider.id)}
                <li>
                  <button
                    type="button"
                    class="flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors {provider.id ===
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
                </li>
              {/each}
            </ul>
          </fieldset>

          <div class="flex flex-wrap gap-2">
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

      {#if (onUseEnrollmentCode || onUnlockWithPassword) && (showProviderPicker || showSavedProviders || showSetup)}
        <div class="mt-5 border-t border-border/60 pt-4 space-y-2">
          {#if onUnlockWithPassword && !passwordFormOpen && (showSavedProviders || showSetup)}
            <div>
              <button
                type="button"
                class="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                data-testid="open-password-unlock-btn"
                onclick={() => {
                  passwordFormOpen = true
                  enrollmentCodeFormOpen = false
                }}
              >
                <ShieldCheck class="size-3.5" />
                Unlock with vault password instead
              </button>
            </div>
          {/if}

          {#if onUnlockWithPassword && passwordFormOpen}
            <form
              class="space-y-3"
              onsubmit={(e) => {
                e.preventDefault()
                if (!onUnlockWithPassword) return
                const trimmed = passwordInput.trim()
                if (!trimmed) return
                void onUnlockWithPassword(trimmed)
              }}
            >
              <div class="flex items-start justify-between gap-2">
                <div class="space-y-1">
                  <h4
                    class="text-xs font-semibold text-foreground inline-flex items-center gap-1.5"
                  >
                    <ShieldCheck class="size-3.5 text-primary" /> Unlock with password
                  </h4>
                  <p class="text-xs text-muted-foreground text-pretty">
                    Decrypts the active provider's vault using its password
                    envelope. Works whether this device is already enrolled or
                    joining for the first time.
                  </p>
                </div>
                <button
                  type="button"
                  class="text-xs text-muted-foreground hover:text-foreground"
                  onclick={() => {
                    passwordFormOpen = false
                    passwordInput = ''
                  }}
                >
                  Cancel
                </button>
              </div>
              <input
                type="password"
                class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="Vault password"
                bind:value={passwordInput}
                autocomplete="current-password"
                data-testid="login-password-input"
                required
              />
              <div class="flex justify-end">
                <Button
                  type="submit"
                  size="sm"
                  disabled={isVerifying || !passwordInput.trim()}
                  data-testid="submit-password-unlock-btn"
                >
                  {#if isVerifying}
                    <RefreshCw class="size-3.5 animate-spin" /> Unlocking…
                  {:else}
                    <ShieldCheck class="size-3.5" /> Unlock
                  {/if}
                </Button>
              </div>
            </form>
          {/if}

          {#if onUseEnrollmentCode && !enrollmentCodeFormOpen && (showProviderPicker || showSavedProviders)}
            <button
              type="button"
              class="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
              data-testid="open-enrollment-code-btn"
              onclick={() => {
                enrollmentCodeFormOpen = true
                passwordFormOpen = false
              }}
            >
              <QrCode class="size-3.5" />
              Have an enrollment code from another device?
            </button>
          {:else if onUseEnrollmentCode && enrollmentCodeFormOpen}
            <form
              class="space-y-3"
              onsubmit={(e) => {
                e.preventDefault()
                if (!onUseEnrollmentCode) return
                const trimmed = enrollmentCodeInput.trim()
                if (!trimmed) return
                void onUseEnrollmentCode(trimmed)
              }}
            >
              <div class="flex items-start justify-between gap-2">
                <div class="space-y-1">
                  <h4
                    class="text-xs font-semibold text-foreground inline-flex items-center gap-1.5"
                  >
                    <QrCode class="size-3.5 text-primary" /> Enroll with code
                  </h4>
                  <p class="text-xs text-muted-foreground text-pretty">
                    Paste the code from an enrolled device. Provider credentials
                    and password are unpacked locally.
                  </p>
                </div>
                <button
                  type="button"
                  class="text-xs text-muted-foreground hover:text-foreground"
                  onclick={() => {
                    enrollmentCodeFormOpen = false
                    enrollmentCodeInput = ''
                  }}
                >
                  Cancel
                </button>
              </div>
              <textarea
                rows="3"
                class="w-full font-mono text-[11px] leading-relaxed rounded-md border border-border bg-background p-2 focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="Paste enrollment code here…"
                bind:value={enrollmentCodeInput}
                data-testid="enrollment-code-input"></textarea>
              <div class="flex justify-end">
                <Button
                  type="submit"
                  size="sm"
                  disabled={isVerifying || !enrollmentCodeInput.trim()}
                  data-testid="submit-enrollment-code-btn"
                >
                  {#if isVerifying}
                    <RefreshCw class="size-3.5 animate-spin" /> Enrolling…
                  {:else}
                    <ShieldCheck class="size-3.5" /> Enroll
                  {/if}
                </Button>
              </div>
            </form>
          {/if}
        </div>
      {/if}
    </CardContent>
  </Card>
  {#if showProviderPicker && !addProviderOpen && onOpenHelp}
    <ProductIntro {onOpenHelp} />
  {/if}
</div>
