<script lang="ts">
  import {
    Cloud,
    HardDrive,
    RefreshCw,
    ShieldCheck,
    ExternalLink,
    Plus,
    ChevronLeft,
  } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import DeviceEnrollment from '$lib/components/DeviceEnrollment.svelte'
  import type {
    StorageProvider,
    StorageProviderType,
  } from '$lib/auth-providers'
  import type { JoinRequest, VaultMember } from '$lib/nook'
  import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
  } from '$lib/components/ui/card'

  let {
    providers,
    activeProviderId,
    setupType = $bindable(null as StorageProviderType | null),
    githubPat = $bindable(''),
    isVerifying,
    isSaving,
    isInitializing,
    errorMsg,
    successMsg,
    deviceId = '',
    devicePublicKey = '',
    pendingJoins = [] as JoinRequest[],
    vaultMembers = [] as VaultMember[],
    enrollSecretsKey = $bindable(''),
    enrollMembersKey = $bindable(''),
    onUnlock,
    onSelectProvider,
    addProviderOpen = false,
    onBeginAddProvider,
    onCancelAddProvider,
    onBeginSetup,
    onCancelSetup,
    onInitializeEmpty,
    onApproveJoin,
    onEnrollWithDec,
    onRefreshJoins,
  }: {
    providers: StorageProvider[]
    activeProviderId: string | null
    setupType?: StorageProviderType | null
    githubPat: string
    isVerifying: boolean
    isSaving: boolean
    isInitializing: boolean
    errorMsg: string
    successMsg: string
    deviceId?: string
    devicePublicKey?: string
    pendingJoins?: JoinRequest[]
    vaultMembers?: VaultMember[]
    enrollSecretsKey?: string
    enrollMembersKey?: string
    onUnlock: () => void | Promise<void>
    onSelectProvider: (id: string) => void | Promise<void>
    addProviderOpen?: boolean
    onBeginAddProvider?: () => void
    onCancelAddProvider?: () => void
    onBeginSetup: (type: StorageProviderType) => void
    onCancelSetup: () => void
    onInitializeEmpty?: () => void | Promise<void>
    onApproveJoin?: (deviceId: string) => void | Promise<void>
    onEnrollWithDec?: () => void | Promise<void>
    onRefreshJoins?: () => void | Promise<void>
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
          {#if showSavedProviders && !showSetup}
            Unlock your vault with a saved storage provider.
          {:else if showProviderPicker && addProviderOpen}
            Add another storage provider for your vault.
          {:else if showSetup && setupType === 'github'}
            Connect GitHub once — your token is saved in this browser.
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
                  Sync encrypted vault to username/nook.
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
              class="space-y-4 rounded-lg border border-border bg-muted/30 p-3 animate-in fade-in slide-in-from-top-1 duration-200"
            >
              <ol class="space-y-4">
                <li class="flex gap-3">
                  <span
                    class="flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-background text-[10px] font-semibold text-muted-foreground"
                    aria-hidden="true">1</span
                  >
                  <div class="min-w-0 flex-1 space-y-1.5">
                    <p class="text-xs font-medium text-foreground">
                      Create a token on GitHub
                    </p>
                    <p
                      class="text-[11px] leading-relaxed text-muted-foreground"
                    >
                      Classic <span class="font-mono">ghp_</span> token with
                      <span class="font-mono">repo</span> scope.
                    </p>
                    <a
                      href={githubPatUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-testid="github-new-token-btn"
                      class="inline-flex items-center gap-1 text-xs font-medium text-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-foreground"
                    >
                      Open token settings
                      <ExternalLink class="size-3 shrink-0 opacity-70" />
                    </a>
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
                        >username/nook/nook-vault.yaml</span
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

        {#if !showProviderPicker}
          <DeviceEnrollment
          {deviceId}
          {devicePublicKey}
          {pendingJoins}
          {vaultMembers}
          isBusy={isVerifying || isSaving || isInitializing}
          bind:enrollSecretsKey
          bind:enrollMembersKey
          {onApproveJoin}
          {onEnrollWithDec}
          onRefresh={onRefreshJoins}
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

        {#if showSavedProviders}
          <div class="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              type="submit"
              class="sm:min-w-[180px]"
              data-testid="unlock-vault-btn"
            >
              {#if isInitializing}
                <RefreshCw class="size-4 animate-spin" />
                Loading engine…
              {:else if isVerifying}
                <RefreshCw class="size-4 animate-spin" />
                Unlocking…
              {:else}
                <ShieldCheck class="size-4" />
                Unlock vault
              {/if}
            </Button>
          </div>
        {:else if showSetup}
          <div class="flex flex-col gap-2 sm:flex-row sm:justify-end">
            {#if onInitializeEmpty}
              <Button
                type="button"
                variant="outline"
                onclick={onInitializeEmpty}
                disabled={isSaving}
                class="border-border text-foreground hover:bg-accent sm:mr-auto"
              >
                Initialize empty vault
              </Button>
            {/if}
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
