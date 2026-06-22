<script lang="ts">
  import {
    ShieldCheck,
    RefreshCw,
    HardDrive,
    Cloud,
    CheckCircle2,
    Plus,
    ChevronLeft,
  } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import DeviceEnrollment from '$lib/components/DeviceEnrollment.svelte'
  import ProviderPicker from '$lib/components/ProviderPicker.svelte'
  import ProviderSetupFields from '$lib/components/ProviderSetupFields.svelte'
  import type {
    StorageProvider,
    StorageProviderType,
  } from '$lib/auth-providers'
  import { DEFAULT_GITHUB_REPO } from '$lib/auth-providers'
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
    isAuthenticated,
    isVerifying,
    isSaving,
    isInitializing,
    errorMsg,
    deviceId = '',
    devicePublicKey = '',
    pendingJoins = [] as JoinRequest[],
    vaultMembers = [] as VaultMember[],
    addProviderOpen = false,
    setupType = $bindable(null as StorageProviderType | null),
    githubPat = $bindable(''),
    githubRepo = $bindable(DEFAULT_GITHUB_REPO),
    onReconnect,
    onSelectProvider,
    onBeginAddProvider,
    onCancelAddProvider,
    onBeginSetup,
    onCancelSetup,
    onApproveJoin,
    onRefreshJoins,
  }: {
    providers: StorageProvider[]
    activeProviderId: string | null
    isAuthenticated: boolean
    isVerifying: boolean
    isSaving: boolean
    isInitializing: boolean
    errorMsg: string
    deviceId?: string
    devicePublicKey?: string
    pendingJoins?: JoinRequest[]
    vaultMembers?: VaultMember[]
    addProviderOpen?: boolean
    setupType?: StorageProviderType | null
    githubPat: string
    githubRepo: string
    onReconnect: () => void | Promise<void>
    onSelectProvider: (id: string) => void | Promise<void>
    onBeginAddProvider?: () => void
    onCancelAddProvider?: () => void
    onBeginSetup: (type: StorageProviderType) => void
    onCancelSetup: () => void
    onApproveJoin?: (deviceId: string) => void | Promise<void>
    onRefreshJoins?: () => void | Promise<void>
  } = $props()

  const showSetup = $derived(setupType !== null)
  const addingProvider = $derived(addProviderOpen || showSetup)
</script>

<div class="w-full animate-in fade-in duration-300">
  <Card
    class="border-border bg-card/80 shadow-lg shadow-black/20 backdrop-blur-sm overflow-hidden"
  >
    <CardHeader class="border-b border-border/60 pb-4 pt-5">
      <div class="flex items-start justify-between gap-3">
        <div class="space-y-1">
          {#if addingProvider}
            <button
              type="button"
              class="mb-2 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              data-testid="cancel-add-provider-btn"
              onclick={() =>
                showSetup ? onCancelSetup() : onCancelAddProvider?.()}
            >
              <ChevronLeft class="size-3.5" />
              Back to saved providers
            </button>
          {/if}
          <CardTitle
            class="text-lg font-semibold tracking-tight text-foreground"
          >
            {#if showSetup}
              Connect to {setupType === 'github' ? 'GitHub' : 'this device'}
            {:else if addProviderOpen}
              Add storage provider
            {:else}
              Storage & devices
            {/if}
          </CardTitle>
          <CardDescription class="text-pretty">
            {#if showSetup}
              Connect and save this provider in this browser. Only the active
              provider is used for sync until you switch.
            {:else if addProviderOpen}
              Pick where to store another encrypted vault file. Each provider
              can point at a different vault.
            {:else}
              Tap a saved provider to switch and reconnect immediately, or add
              another provider.
            {/if}
          </CardDescription>
        </div>
        {#if isAuthenticated && !addingProvider}
          <span
            class="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-500"
            data-testid="connected-badge"
          >
            <CheckCircle2 class="size-3" />
            Connected
          </span>
        {/if}
      </div>
    </CardHeader>

    <CardContent class="pt-4 space-y-4">
      <form
        novalidate
        onsubmit={(e) => {
          e.preventDefault()
          void onReconnect()
        }}
        class="space-y-4"
      >
        {#if showSetup}
          <ProviderSetupFields
            setupType={setupType!}
            bind:githubPat
            bind:githubRepo
            idPrefix="settings"
            {onCancelSetup}
          />
        {:else if addProviderOpen}
          <ProviderPicker onSelect={onBeginSetup} />
        {:else}
          <fieldset class="space-y-2">
            <legend class="text-xs font-medium text-foreground">
              Saved providers
            </legend>
            {#if providers.length === 0}
              <p class="text-xs text-muted-foreground">
                No providers saved yet.
              </p>
            {:else}
              <ul class="space-y-2" data-testid="settings-providers-list">
                {#each providers as provider (provider.id)}
                  <li>
                    <button
                      type="button"
                      class="flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors {provider.id ===
                      activeProviderId
                        ? 'border-primary/40 bg-primary/5 text-foreground'
                        : 'border-border bg-muted/30 text-muted-foreground hover:bg-accent hover:text-foreground'}"
                      data-testid="settings-provider-{provider.type}"
                      disabled={isVerifying || isInitializing}
                      aria-busy={isVerifying &&
                        provider.id === activeProviderId}
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
                        {#if isVerifying}
                          <RefreshCw class="size-3.5 shrink-0 animate-spin" />
                          <span class="sr-only">Reconnecting</span>
                        {:else}
                          <span
                            class="shrink-0 text-[10px] font-medium uppercase tracking-wide text-primary"
                            >Active</span
                          >
                        {/if}
                      {/if}
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}

            <div class="flex flex-wrap gap-2 pt-1">
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
          </fieldset>
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

        {#if showSetup}
          <div
            class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end"
          >
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

      {#if !addingProvider}
        <DeviceEnrollment
          {deviceId}
          {devicePublicKey}
          {pendingJoins}
          {vaultMembers}
          isBusy={isVerifying || isSaving || isInitializing}
          {onApproveJoin}
          onRefresh={onRefreshJoins}
        />
      {/if}
    </CardContent>
  </Card>
</div>
