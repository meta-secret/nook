<script lang="ts">
  import { RefreshCw, ShieldCheck, ChevronLeft } from '@lucide/svelte'
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
  import ProviderSetupFields from '$lib/components/ProviderSetupFields.svelte'
  import LoginWizard from '$lib/components/login/LoginWizard.svelte'
  import LoginProviderManagement from '$lib/components/login/LoginProviderManagement.svelte'
  import LoginEnrollmentPanel from '$lib/components/login/LoginEnrollmentPanel.svelte'
  import type { VaultPasswordEntrySummary } from '$lib/vault-password'

  let {
    providers,
    activeProviderId,
    setupType = $bindable(null as StorageProviderType | null),
    githubPat = $bindable(''),
    githubRepo = $bindable(DEFAULT_GITHUB_REPO),
    isVerifying,
    isInitializing,
    addProviderOpen = false,
    onUnlock,
    onSelectProvider,
    onConnectProvider,
    onBackToLoginProvider,
    onBeginAddProvider,
    onCancelAddProvider,
    onBeginSetup,
    onCancelSetup,
    onOpenHelp,
    onUseEnrollmentCode,
    onUnlockWithPassword,
    loginFlowStep = 'connection',
    passwordEntries = [] as VaultPasswordEntrySummary[],
    selectedPasswordEntryId = $bindable(null as string | null),
    onRemoveProvider,
    loginPasswordPrompt = false,
    onConsumeLoginPasswordPrompt,
  }: {
    providers: StorageProvider[]
    activeProviderId: string | null
    loginFlowStep?: 'connection' | 'authorization'
    setupType?: StorageProviderType | null
    githubPat: string
    githubRepo: string
    isVerifying: boolean
    isInitializing: boolean
    addProviderOpen?: boolean
    onUnlock: () => void | Promise<void>
    onSelectProvider: (id: string) => void | Promise<void>
    onConnectProvider?: () => void | Promise<void>
    onBackToLoginProvider?: () => void
    onBeginAddProvider?: () => void
    onCancelAddProvider?: () => void
    onBeginSetup: (type: StorageProviderType) => void
    onCancelSetup: () => void
    onOpenHelp?: () => void
    onUseEnrollmentCode?: (code: string) => void | Promise<void>
    onUnlockWithPassword?: (
      entryId: string,
      password: string,
    ) => void | Promise<void>
    onRemoveProvider?: (id: string) => void | Promise<void>
    loginPasswordPrompt?: boolean
    passwordEntries?: VaultPasswordEntrySummary[]
    selectedPasswordEntryId?: string | null
    onConsumeLoginPasswordPrompt?: () => void
  } = $props()

  let manageProvidersOpen = $state(false)
  let enrollmentPanelOpen = $state(false)

  const hasProviders = $derived(providers.length > 0)
  const showSetup = $derived(setupType !== null)
  const showWizard = $derived(hasProviders && !showSetup && !addProviderOpen)
  const showProviderSetup = $derived(!showSetup && !showWizard)
  const activeProvider = $derived(
    providers.find((p) => p.id === activeProviderId) ?? null,
  )
  const isConnecting = $derived(
    isVerifying && showWizard && loginFlowStep === 'connection' && !showSetup,
  )
  const isUnlocking = $derived(
    isVerifying &&
      showWizard &&
      loginFlowStep === 'authorization' &&
      !showSetup,
  )
  const showEnrollmentAccess = $derived(
    Boolean(onUseEnrollmentCode) &&
      (showProviderSetup || showWizard || showSetup),
  )

  function handleFirstConnectSubmit(e: Event) {
    e.preventDefault()
    void onUnlock()
  }
</script>

<div
  class="w-full space-y-3 animate-in fade-in duration-300"
  data-testid="login-gate"
>
  {#if showWizard}
    <LoginProviderManagement
      variant="manage"
      {providers}
      {isVerifying}
      {isInitializing}
      bind:open={manageProvidersOpen}
      {onRemoveProvider}
      {onBeginAddProvider}
    />
  {/if}

  {#if !hasProviders && !showSetup && onOpenHelp}
    <ProductIntro {onOpenHelp} />
  {/if}

  <Card
    class="gap-0 border-border bg-card/80 py-0 shadow-lg shadow-black/20 backdrop-blur-sm overflow-hidden"
  >
    <CardHeader
      class={showWizard
        ? 'border-b-0 px-5 pb-1 pt-3 sm:px-6'
        : 'border-b border-border/60 px-6 pb-4 pt-5'}
    >
      <div class="space-y-1">
        {#if addProviderOpen && showWizard}
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
          {#if showWizard}
            Unlock your vault
          {:else if showSetup}
            Connect to {setupType === 'github' ? 'GitHub' : 'this device'}
          {:else if !hasProviders}
            Set up storage
          {:else if addProviderOpen}
            Add storage provider
          {:else}
            Set up storage
          {/if}
        </CardTitle>
        {#if isUnlocking}
          <CardDescription class="text-pretty">Unlocking…</CardDescription>
        {:else if isConnecting}
          <CardDescription class="text-pretty">Connecting…</CardDescription>
        {:else if showWizard}
          <CardDescription class="text-pretty">
            Connect to storage, then get access.
          </CardDescription>
        {:else if showSetup && setupType === 'github'}
          <CardDescription class="text-pretty">
            Sign in with a personal access token — plaintext secrets never leave
            this browser.
          </CardDescription>
        {:else if showSetup}
          <CardDescription class="text-pretty">
            Encrypted vault stays in browser storage on this device.
          </CardDescription>
        {:else if !hasProviders}
          <CardDescription class="text-pretty">
            Add a provider first — then you can connect and unlock.
          </CardDescription>
        {:else if addProviderOpen}
          <CardDescription class="text-pretty">
            Another encrypted vault file on a different provider.
          </CardDescription>
        {/if}
      </div>
    </CardHeader>

    <CardContent
      class={showWizard
        ? 'px-5 pb-5 pt-0 sm:px-6 sm:pb-6'
        : 'px-6 pb-5 pt-4 sm:pb-6'}
    >
      {#if showWizard}
        <LoginWizard
          step={loginFlowStep}
          {providers}
          {activeProviderId}
          {activeProvider}
          {passwordEntries}
          bind:selectedPasswordEntryId
          {isVerifying}
          {isInitializing}
          {isConnecting}
          {isUnlocking}
          {loginPasswordPrompt}
          {onSelectProvider}
          onConnect={() => onConnectProvider?.()}
          onBackToConnection={onBackToLoginProvider}
          {onUnlock}
          {onUnlockWithPassword}
          {onConsumeLoginPasswordPrompt}
        />
      {:else if showSetup && setupType}
        <form novalidate onsubmit={handleFirstConnectSubmit} class="space-y-4">
          <ProviderSetupFields
            {setupType}
            bind:githubPat
            bind:githubRepo
            idPrefix="login"
            {onCancelSetup}
          />
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
        </form>
      {:else if showProviderSetup}
        <LoginProviderManagement
          variant="setup"
          {providers}
          {isVerifying}
          {isInitializing}
          addingProvider={addProviderOpen}
          {onBeginSetup}
          {onCancelAddProvider}
          {onRemoveProvider}
        />
      {/if}
    </CardContent>
  </Card>

  {#if showEnrollmentAccess}
    <LoginEnrollmentPanel
      bind:open={enrollmentPanelOpen}
      {isVerifying}
      {onUseEnrollmentCode}
    />
  {/if}
</div>
