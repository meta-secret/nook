<script lang="ts">
  import {
    ShieldCheck,
    RefreshCw,
    HardDrive,
    Cloud,
    CheckCircle2,
    Plus,
    ChevronLeft,
    Trash2,
    Lock,
  } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import ProviderPicker from '$lib/components/ProviderPicker.svelte'
  import ProviderSetupFields from '$lib/components/ProviderSetupFields.svelte'
  import type {
    StorageProvider,
    StorageProviderType,
  } from '$lib/auth-providers'
  import {
    DEFAULT_GITHUB_REPO,
    localizeProviderLabel,
    providerStorageDetail,
  } from '$lib/auth-providers'
  import type { VaultState } from '$lib/vault.svelte'
  let {
    vault,
    providers,
    activeProviderId,
    isAuthenticated,
    isVerifying,
    isInitializing,
    addProviderOpen = false,
    embedded = false,
    setupType = $bindable(null as StorageProviderType | null),
    githubPat = $bindable(''),
    githubRepo = $bindable(DEFAULT_GITHUB_REPO),
    onReconnect,
    onSelectProvider,
    onBeginAddProvider,
    onCancelAddProvider,
    onBeginSetup,
    onCancelSetup,
    onRemoveProvider,
    onLockVault,
  }: {
    vault: VaultState
    providers: StorageProvider[]
    activeProviderId: string | null
    isAuthenticated: boolean
    isVerifying: boolean
    isSaving: boolean
    isInitializing: boolean
    addProviderOpen?: boolean
    embedded?: boolean
    setupType?: StorageProviderType | null
    githubPat: string
    githubRepo: string
    onReconnect: () => void | Promise<void>
    onSelectProvider: (id: string) => void | Promise<void>
    onBeginAddProvider?: () => void
    onCancelAddProvider?: () => void
    onBeginSetup: (type: StorageProviderType) => void
    onCancelSetup: () => void
    onRemoveProvider?: (id: string) => void | Promise<void>
    onLockVault?: () => void
  } = $props()

  function confirmRemoveProvider(provider: StorageProvider) {
    if (!onRemoveProvider) return
    const signedOutNote =
      isAuthenticated && provider.id === activeProviderId
        ? vault.t('auth_storage.signed_out_note')
        : ''
    const ok = confirm(
      vault.t('auth_storage.confirm_remove', {
        label: provider.label,
        signedOutNote,
      }),
    )
    if (ok) {
      void onRemoveProvider(provider.id)
    }
  }

  const showSetup = $derived(setupType !== null)
  const addingProvider = $derived(addProviderOpen || showSetup)
</script>

<div class="w-full animate-in fade-in duration-300 space-y-4">
  {#if addingProvider}
    <div
      class="flex items-start justify-between gap-3 border-b border-border/60 pb-4"
    >
      <div class="space-y-1">
        <button
          type="button"
          class="mb-2 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          data-testid="cancel-add-provider-btn"
          onclick={() =>
            showSetup ? onCancelSetup() : onCancelAddProvider?.()}
        >
          <ChevronLeft class="size-3.5" />
          {vault.t('onboarding.back_to_saved')}
        </button>
        <h2 class="text-base font-semibold text-foreground">
          {#if showSetup}
            {vault.t('auth_storage.connect_to_type', {
              type:
                setupType === 'github'
                  ? vault.t('auth_storage.github')
                  : vault.t('auth_storage.this_device'),
            })}
          {:else}
            {vault.t('onboarding.add_provider')}
          {/if}
        </h2>
        <p class="text-xs text-muted-foreground text-pretty">
          {#if showSetup}
            {vault.t('auth_storage.setup_desc')}
          {:else}
            {vault.t('auth_storage.choose_desc')}
          {/if}
        </p>
      </div>
    </div>
  {:else if !embedded}
    <p class="text-xs text-muted-foreground text-pretty">
      {vault.t('auth_storage.switch_providers_desc')}
    </p>
  {/if}

  <div class="space-y-4">
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
          {vault}
          setupType={setupType!}
          bind:githubPat
          bind:githubRepo
          idPrefix="settings"
          {onCancelSetup}
        />
      {:else if addProviderOpen}
        <ProviderPicker {vault} onSelect={onBeginSetup} />
      {:else}
        <fieldset class="space-y-2">
          {#if providers.length === 0}
            <p class="text-xs text-muted-foreground">
              {vault.t('auth_storage.no_providers_saved')}
            </p>
          {:else}
            <ul
              class="divide-y divide-border/60"
              data-testid="settings-providers-list"
            >
              {#each providers as provider (provider.id)}
                <li class="flex items-center gap-2 py-2.5 first:pt-0 last:pb-0">
                  <button
                    type="button"
                    class="group flex min-w-0 flex-1 items-center gap-3 rounded-md px-1 py-1 text-left transition-colors {provider.id ===
                    activeProviderId
                      ? 'text-foreground'
                      : 'text-muted-foreground hover:text-foreground'}"
                    data-testid="settings-provider-{provider.type}"
                    disabled={isVerifying || isInitializing}
                    aria-busy={isVerifying && provider.id === activeProviderId}
                    onclick={() => void onSelectProvider(provider.id)}
                  >
                    {#if provider.type === 'github'}
                      <Cloud class="size-4 shrink-0 text-primary" />
                    {:else}
                      <HardDrive class="size-4 shrink-0 text-primary" />
                    {/if}
                    <span class="min-w-0 flex-1">
                      <span class="block truncate font-medium text-sm">
                        {localizeProviderLabel(provider.label, vault.t)}
                      </span>
                      <span
                        class="block truncate font-mono text-[11px] text-muted-foreground"
                      >
                        {providerStorageDetail(provider, vault.t)}
                      </span>
                    </span>
                    {#if provider.id === activeProviderId}
                      {#if isVerifying}
                        <RefreshCw
                          class="size-3.5 shrink-0 animate-spin text-primary"
                        />
                      {:else}
                        <span
                          class="inline-flex shrink-0 items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400"
                        >
                          <CheckCircle2 class="size-3" />
                          {vault.t('common.active')}
                        </span>
                      {/if}
                    {:else}
                      <span
                        class="shrink-0 text-xs font-medium text-primary opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        {vault.t('common.switch')}
                      </span>
                    {/if}
                  </button>
                  {#if provider.id === activeProviderId && isAuthenticated && onLockVault}
                    <button
                      type="button"
                      class="inline-flex shrink-0 items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-primary disabled:opacity-50"
                      aria-label={vault.t('common.lock_vault')}
                      title={vault.t('common.lock_vault')}
                      data-testid="lock-vault-btn"
                      disabled={isVerifying || isInitializing}
                      onclick={() => onLockVault()}
                    >
                      <Lock class="size-4" />
                    </button>
                  {/if}
                  {#if onRemoveProvider}
                    <button
                      type="button"
                      class="inline-flex shrink-0 items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                      aria-label="{vault.t(
                        'common.remove',
                      )} {localizeProviderLabel(provider.label, vault.t)}"
                      data-testid="remove-provider-{provider.id}"
                      disabled={isVerifying || isInitializing}
                      onclick={() => confirmRemoveProvider(provider)}
                    >
                      <Trash2 class="size-4" />
                    </button>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}

          <button
            type="button"
            class="inline-flex items-center gap-1.5 pt-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            data-testid="add-provider-btn"
            onclick={() => onBeginAddProvider?.()}
          >
            <Plus class="size-4" />
            {vault.t('onboarding.add_provider')}
          </button>
        </fieldset>
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
              {vault.t('onboarding.loading_engine')}
            {:else if isVerifying}
              <RefreshCw class="size-4 animate-spin" />
              {vault.t('common.connecting')}
            {:else}
              <ShieldCheck class="size-4" />
              {vault.t('common.connect')}
            {/if}
          </Button>
        </div>
      {/if}
    </form>
  </div>
</div>
