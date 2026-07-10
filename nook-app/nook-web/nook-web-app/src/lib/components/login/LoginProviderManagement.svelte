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
    OAuthFilePreset,
    StorageProvider,
    StorageProviderType,
  } from '$lib/auth-providers'
  import {
    localizeProviderLabel,
    providerStorageDetail,
  } from '$lib/auth-providers'

  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
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
    vault: VaultState
    providers: StorageProvider[]
    variant?: 'setup' | 'manage'
    isVerifying: boolean
    isInitializing: boolean
    open?: boolean
    addingProvider?: boolean
    onBeginSetup?: (
      type: StorageProviderType,
      oauthPreset?: OAuthFilePreset,
    ) => void
    onCancelAddProvider?: () => void
    onRemoveProvider?: (id: string) => void | Promise<void>
    onBeginAddProvider?: () => void
  } = $props()

  const isSetup = $derived(variant === 'setup')

  function confirmRemoveProvider(provider: StorageProvider) {
    if (!onRemoveProvider) return
    const ok = confirm(
      vault.t('auth_storage.confirm_remove', {
        label: provider.label,
        signedOutNote: '',
      }),
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
        {vault.t('login_wizard.back_to_unlock')}
      </button>
    {/if}

    <div class="space-y-1">
      <h2 class="text-sm font-semibold text-foreground">
        {#if addingProvider}
          {vault.t('onboarding.add_provider')}
        {:else}
          {vault.t('login_wizard.choose_store_vault')}
        {/if}
      </h2>
      <p class="text-xs text-muted-foreground text-pretty">
        {#if addingProvider}
          {vault.t('login_wizard.add_provider_desc')}
        {:else}
          {vault.t('login_wizard.before_connect_desc')}
        {/if}
      </p>
    </div>

    {#if onBeginSetup}
      <ProviderPicker {vault} onSelect={onBeginSetup} excludeLocal />
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
          >{vault.t('login_wizard.manage_providers')}</span
        >
        {#if providers.length > 0}
          <span class="text-sm text-muted-foreground">
            · {providers.length}
            {vault.t('login_wizard.saved_count')}
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
          {vault.t('login_wizard.manage_providers_desc')}
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
                  {localizeProviderLabel(provider.label, vault.t)}
                </div>
                <div
                  class="truncate text-xs text-muted-foreground"
                  data-testid="provider-detail-{provider.id}"
                >
                  {providerStorageDetail(provider, vault.t)}
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
                  {vault.t('common.remove')}
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
            {vault.t('onboarding.add_provider_btn')}
          </button>
        {/if}
      </div>
    {/if}
  </div>
{/if}
