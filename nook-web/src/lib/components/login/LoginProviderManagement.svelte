<script lang="ts">
  import {
    ChevronDown,
    ChevronLeft,
    Cloud,
    HardDrive,
    Plus,
    Settings2,
  } from '@lucide/svelte'
  import ProviderPicker from '$lib/components/ProviderPicker.svelte'
  import type {
    StorageProvider,
    StorageProviderType,
  } from '$lib/auth-providers'
  import { providerStorageDetail } from '$lib/auth-providers'

  let {
    providers,
    variant = 'manage',
    isVerifying,
    isInitializing,
    open = $bindable(false),
    addingProvider = false,
    onBeginSetup,
    onCancelAddProvider,
    onRemoveProvider,
    onBeginAddProvider,
  }: {
    providers: StorageProvider[]
    variant?: 'setup' | 'manage'
    isVerifying: boolean
    isInitializing: boolean
    open?: boolean
    addingProvider?: boolean
    onBeginSetup?: (type: StorageProviderType) => void
    onCancelAddProvider?: () => void
    onRemoveProvider?: (id: string) => void | Promise<void>
    onBeginAddProvider?: () => void
  } = $props()

  const isSetup = $derived(variant === 'setup')

  function confirmRemoveProvider(provider: StorageProvider) {
    if (!onRemoveProvider) return
    const ok = confirm(
      `Remove "${provider.label}" from saved providers? Your vault file on storage is not deleted.`,
    )
    if (ok) {
      void onRemoveProvider(provider.id)
    }
  }
</script>

{#if isSetup}
  <div class="space-y-4" data-testid="login-provider-setup">
    {#if addingProvider && onCancelAddProvider}
      <button
        type="button"
        class="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        data-testid="cancel-add-provider-btn"
        onclick={() => onCancelAddProvider()}
      >
        <ChevronLeft class="size-3.5" />
        Back to unlock
      </button>
    {/if}

    <div class="space-y-1">
      <h2 class="text-sm font-semibold text-foreground">
        {#if addingProvider}
          Add a storage provider
        {:else}
          Choose where to store your vault
        {/if}
      </h2>
      <p class="text-xs text-muted-foreground text-pretty">
        {#if addingProvider}
          Pick another place for an encrypted vault file. Each saved provider is
          a separate vault location in this browser.
        {:else}
          Before you can connect, add a storage provider — local device or
          GitHub.
        {/if}
      </p>
    </div>

    {#if onBeginSetup}
      <ProviderPicker onSelect={onBeginSetup} />
    {/if}
  </div>
{:else}
  <div
    class="overflow-hidden rounded-xl border border-border/60 bg-card/60"
    data-testid="login-manage-providers"
  >
    <button
      type="button"
      class="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-muted/30 {open
        ? 'bg-muted/20'
        : ''}"
      aria-expanded={open}
      data-testid="login-manage-providers-toggle"
      disabled={isVerifying || isInitializing}
      onclick={() => {
        open = !open
      }}
    >
      <Settings2 class="size-5 shrink-0 text-muted-foreground" />
      <span class="min-w-0 flex-1 text-base">
        <span class="font-semibold text-foreground"
          >Manage storage providers</span
        >
        {#if providers.length > 0}
          <span class="text-sm text-muted-foreground">
            · {providers.length} saved
          </span>
        {/if}
      </span>
      <ChevronDown
        class="size-5 shrink-0 text-muted-foreground transition-transform duration-200 {open
          ? 'rotate-180'
          : ''}"
      />
    </button>

    {#if open}
      <div
        class="space-y-3 border-t border-border/40 bg-background/50 px-3.5 py-3"
        data-testid="login-manage-providers-panel"
      >
        <p class="text-xs text-muted-foreground text-pretty">
          Add or remove saved providers. Vault files on storage are not deleted.
        </p>

        <ul
          class="divide-y divide-border/40"
          data-testid="login-manage-providers-list"
        >
          {#each providers as provider (provider.id)}
            <li class="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
              {#if provider.type === 'github'}
                <Cloud class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              {:else}
                <HardDrive
                  class="mt-0.5 size-4 shrink-0 text-muted-foreground"
                />
              {/if}
              <div class="min-w-0 flex-1">
                <div class="truncate text-sm font-medium text-foreground">
                  {provider.label}
                </div>
                <div
                  class="truncate font-mono text-[11px] text-muted-foreground"
                  data-testid="provider-detail-{provider.id}"
                >
                  {providerStorageDetail(provider)}
                </div>
              </div>
              {#if onRemoveProvider}
                <button
                  type="button"
                  class="shrink-0 text-xs font-medium text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
                  data-testid="remove-provider-{provider.id}"
                  disabled={isVerifying || isInitializing}
                  onclick={() => confirmRemoveProvider(provider)}
                >
                  Remove
                </button>
              {/if}
            </li>
          {/each}
        </ul>

        {#if onBeginAddProvider}
          <button
            type="button"
            class="inline-flex items-center gap-1.5 text-sm font-medium text-primary transition-colors hover:text-primary/80 disabled:opacity-50"
            data-testid="add-provider-btn"
            disabled={isVerifying || isInitializing}
            onclick={() => onBeginAddProvider()}
          >
            <Plus class="size-4" />
            Add provider
          </button>
        {/if}
      </div>
    {/if}
  </div>
{/if}
