<script lang="ts">
  import { Cloud, HardDrive, RefreshCw } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import {
    localizeProviderLabel,
    providerStorageDetail,
    type StorageProvider,
  } from '$lib/auth-providers'

  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    providers,
    activeProviderId,
    isVerifying,
    isInitializing,
    isConnecting = false,
    onSelectProvider,
    onConnect,
  }: {
    vault: VaultState
    providers: StorageProvider[]
    activeProviderId: string | null
    isVerifying: boolean
    isInitializing: boolean
    isConnecting?: boolean
    onSelectProvider: (id: string) => void | Promise<void>
    onConnect?: () => void | Promise<void>
  } = $props()
</script>

<div class="space-y-2">
  <div
    class="space-y-2"
    role="radiogroup"
    aria-label={vault.t('login_wizard.storage_provider')}
    data-testid="saved-providers-list"
  >
    {#each providers as provider (provider.id)}
      {@const selected = provider.id === activeProviderId}
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        class="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-all {selected
          ? 'bg-primary/[0.08] ring-1 ring-inset ring-primary/35 text-foreground shadow-sm'
          : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'}"
        data-testid="saved-provider-{provider.type}"
        disabled={isVerifying || isInitializing}
        onclick={() => void onSelectProvider(provider.id)}
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
        {:else if provider.type === 'oauth-file'}
          <svg
            class="size-4 shrink-0 opacity-80"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              fill="currentColor"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
            />
            <path
              fill="currentColor"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="currentColor"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            />
            <path
              fill="currentColor"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
        {:else}
          <HardDrive class="size-4 shrink-0 opacity-80" />
        {/if}
        <div class="min-w-0 flex-1">
          <div class="truncate font-medium">
            {localizeProviderLabel(provider.label, vault.t)}
          </div>
          <div
            class="truncate font-mono text-[11px] {selected
              ? 'text-muted-foreground'
              : 'text-muted-foreground/80'}"
          >
            {providerStorageDetail(provider, vault.t)}
          </div>
        </div>
      </button>
    {/each}
  </div>

  <Button
    type="button"
    variant="outline"
    class="w-full border-primary/30 bg-primary/5 font-medium text-foreground hover:bg-primary/10 hover:text-foreground"
    data-testid="login-connect-provider-btn"
    disabled={isVerifying || isInitializing || !activeProviderId || !onConnect}
    onclick={() => void onConnect?.()}
  >
    {#if isConnecting}
      <RefreshCw class="size-4 animate-spin" />
      {vault.t('common.connecting')}
    {:else}
      {vault.t('common.connect')}
    {/if}
  </Button>
</div>
