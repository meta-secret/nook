<script lang="ts">
  import {
    Cloud,
    HardDrive,
    RefreshCw,
    ShieldCheck,
    ExternalLink,
    KeyRound,
    Plus,
    ChevronLeft,
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
  import { buttonVariants } from '$lib/components/ui/button/button.svelte'
  import { cn } from '$lib/utils'

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
  } = $props()

  const githubPatUrl =
    'https://github.com/settings/tokens/new?scopes=repo&description=nook'

  const hasProviders = $derived(providers.length > 0)
  const showSetup = $derived(setupType !== null)
  const showSavedProviders = $derived(
    hasProviders && !showSetup && !addProviderOpen,
  )
  const showProviderPicker = $derived(
    (!hasProviders || addProviderOpen) && !showSetup,
  )
  const showGithubPat = $derived(showSetup && setupType === 'github')
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
          Sign in to nook
        </CardTitle>
        <CardDescription>
          {#if isUnlocking}
            Unlocking your vault…
          {:else if showSavedProviders && !showSetup}
            Your storage provider is saved — unlock to open your vault.
          {:else if showProviderPicker && addProviderOpen}
            Add another storage provider for your vault.
          {:else if showSetup && setupType === 'github'}
            Create a GitHub token first, then paste it below to connect.
          {:else if showSetup}
            Set up local storage on this device.
          {:else}
            Choose a storage provider to access your encrypted vault.
          {/if}
        </CardDescription>
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
                    onclick={() => onSelectProvider(provider.id)}
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
                      <span
                        class="shrink-0 text-[10px] font-medium uppercase tracking-wide text-primary"
                        >Active</span
                      >
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
          <fieldset class="space-y-2">
            <legend class="text-xs font-medium text-foreground">
              Choose a provider
            </legend>
            <div class="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                class="flex flex-col items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-left transition-colors hover:border-primary/30 hover:bg-accent"
                data-testid="provider-option-local"
                onclick={() => onBeginSetup('local')}
              >
                <HardDrive class="size-4 text-foreground" />
                <span class="text-sm font-medium text-foreground"
                  >This device</span
                >
                <span class="text-xs text-muted-foreground">
                  Local IndexedDB — no sign-in required.
                </span>
              </button>
              <button
                type="button"
                class="flex flex-col items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-left transition-colors hover:border-primary/30 hover:bg-accent"
                data-testid="provider-option-github"
                onclick={() => onBeginSetup('github')}
              >
                <Cloud class="size-4 text-foreground" />
                <span class="text-sm font-medium text-foreground">GitHub</span>
                <span class="text-xs text-muted-foreground">
                  Sync encrypted vault to a GitHub repo (default: nook).
                </span>
              </button>
            </div>
          </fieldset>
        {:else}
          <div
            class="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm"
          >
            {#if setupType === 'github'}
              <Cloud class="size-4 shrink-0 text-foreground" />
              <span class="font-medium text-foreground">GitHub sync</span>
            {:else}
              <HardDrive class="size-4 shrink-0 text-foreground" />
              <span class="font-medium text-foreground">This device</span>
            {/if}
            <button
              type="button"
              class="ml-auto text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
              data-testid="cancel-provider-setup"
              onclick={onCancelSetup}
            >
              Change provider
            </button>
          </div>

          {#if showGithubPat}
            <div
              class="space-y-4 rounded-lg border border-primary/25 bg-primary/5 p-4 animate-in fade-in slide-in-from-top-1 duration-200"
              data-testid="github-token-setup"
            >
              <div class="space-y-3">
                <div class="flex items-start gap-3">
                  <div
                    class="flex size-9 shrink-0 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary"
                  >
                    <KeyRound class="size-4" />
                  </div>
                  <div class="min-w-0 flex-1 space-y-1">
                    <p class="text-sm font-semibold text-foreground">
                      New here? Create a GitHub token first
                    </p>
                    <p class="text-xs leading-relaxed text-muted-foreground">
                      Nook needs a classic personal access token
                      (<span class="font-mono text-foreground/90">ghp_</span>)
                      with <span class="font-mono text-foreground/90">repo</span>
                      scope so it can read and write your vault file.
                    </p>
                  </div>
                </div>
                <a
                  href={githubPatUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="github-new-token-btn"
                  class={cn(
                    buttonVariants({ variant: 'default', size: 'default' }),
                    'w-full sm:w-auto',
                  )}
                >
                  Create token on GitHub
                  <ExternalLink class="size-4" />
                </a>
              </div>

              <ol class="space-y-4 border-t border-primary/15 pt-4">
                <li class="flex gap-3">
                  <span
                    class="flex size-5 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-[10px] font-semibold text-primary"
                    aria-hidden="true">1</span
                  >
                  <div class="min-w-0 flex-1 space-y-1.5">
                    <p class="text-xs font-medium text-foreground">
                      Open GitHub and generate the token
                    </p>
                    <p
                      class="text-[11px] leading-relaxed text-muted-foreground"
                    >
                      Use the button above — GitHub opens with
                      <span class="font-mono">repo</span> scope pre-selected.
                      Copy the token when it is shown; you will not see it again.
                    </p>
                  </div>
                </li>

                <li class="flex gap-3">
                  <span
                    class="flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-background text-[10px] font-semibold text-muted-foreground"
                    aria-hidden="true">2</span
                  >
                  <div class="min-w-0 flex-1 space-y-1.5">
                    <label
                      class="text-xs font-medium text-foreground"
                      for="login-github-repo"
                    >
                      Repository name
                    </label>
                    <input
                      id="login-github-repo"
                      type="text"
                      bind:value={githubRepo}
                      placeholder={DEFAULT_GITHUB_REPO}
                      autocomplete="off"
                      spellcheck="false"
                      data-testid="github-repo-input"
                      class="flex h-9 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-hidden focus:ring-2 focus:ring-ring"
                    />
                    <p class="text-[11px] text-muted-foreground">
                      Repo under your account — vault file is
                      <span class="font-mono text-foreground/80"
                        >nook-vault.yaml</span
                      >. Use a different name for a second vault.
                    </p>
                  </div>
                </li>

                <li class="flex gap-3">
                  <span
                    class="flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-background text-[10px] font-semibold text-muted-foreground"
                    aria-hidden="true">3</span
                  >
                  <div class="min-w-0 flex-1 space-y-1.5">
                    <label
                      class="text-xs font-medium text-foreground"
                      for="login-github-pat"
                    >
                      Paste token here
                    </label>
                    <input
                      id="login-github-pat"
                      type="password"
                      bind:value={githubPat}
                      placeholder="ghp_xxxxxxxxxxxx"
                      autocomplete="off"
                      data-testid="github-pat-input"
                      class="flex h-9 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-hidden focus:ring-2 focus:ring-ring"
                    />
                    <p class="text-[11px] text-muted-foreground">
                      Saved in this browser after first sign-in. Syncs to
                      <span class="font-mono text-foreground/80"
                        >username/{githubRepo.trim() ||
                          DEFAULT_GITHUB_REPO}/nook-vault.yaml</span
                      >
                    </p>
                  </div>
                </li>
              </ol>
            </div>
          {:else if setupType === 'github'}
            <p class="text-xs text-muted-foreground">
              Token saved in this browser. Click sign in to unlock your vault.
            </p>
          {:else}
            <p class="text-xs text-muted-foreground">
              Your vault is stored in IndexedDB on this device. No token needed.
            </p>
          {/if}
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

        {#if showSavedProviders}
          <div class="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              type="submit"
              class="sm:min-w-[180px]"
              data-testid="unlock-vault-btn"
              disabled={isUnlocking}
            >
              {#if isInitializing || isUnlocking}
                <RefreshCw class="size-4 animate-spin" />
                {isUnlocking ? 'Unlocking…' : 'Loading engine…'}
              {:else}
                <ShieldCheck class="size-4" />
                Unlock vault
              {/if}
            </Button>
          </div>
        {:else if showSetup}
          <div class="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              type="submit"
              class="sm:min-w-[180px]"
              data-testid="sign-in-btn"
            >
              {#if isInitializing}
                <RefreshCw class="size-4 animate-spin" />
                Loading engine…
              {:else if isVerifying}
                <RefreshCw class="size-4 animate-spin" />
                Signing in…
              {:else}
                <ShieldCheck class="size-4" />
                Sign in
              {/if}
            </Button>
          </div>
        {/if}
      </form>
    </CardContent>
  </Card>
</div>
