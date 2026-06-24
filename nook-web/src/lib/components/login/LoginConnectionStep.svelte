<script lang="ts">
  import { Cloud, HardDrive, RefreshCw } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import type { StorageProvider } from '$lib/auth-providers'
  import { providerStorageDetail } from '$lib/auth-providers'

  let {
    providers,
    activeProviderId,
    isVerifying,
    isInitializing,
    isConnecting = false,
    onSelectProvider,
    onConnect,
  }: {
    providers: StorageProvider[]
    activeProviderId: string | null
    isVerifying: boolean
    isInitializing: boolean
    isConnecting?: boolean
    onSelectProvider: (id: string) => void | Promise<void>
    onConnect: () => void | Promise<void>
  } = $props()
</script>

<div class="space-y-2">
  <div
    class="space-y-2"
    role="radiogroup"
    aria-label="Storage provider"
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
        {:else}
          <HardDrive class="size-4 shrink-0 opacity-80" />
        {/if}
        <div class="min-w-0 flex-1">
          <div class="truncate font-medium">{provider.label}</div>
          <div
            class="truncate font-mono text-[11px] {selected
              ? 'text-muted-foreground'
              : 'text-muted-foreground/80'}"
          >
            {providerStorageDetail(provider)}
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
    disabled={isVerifying || isInitializing || !activeProviderId}
    onclick={() => void onConnect()}
  >
    {#if isConnecting}
      <RefreshCw class="size-4 animate-spin" />
      Connecting…
    {:else}
      Connect
    {/if}
  </Button>
</div>
