<script lang="ts">
  import {
    ShieldCheck,
    RefreshCw,
    HardDrive,
    Cloud,
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
    syncProviders,
    syncingProviderId = null,
    isAuthenticated,
    isVerifying,
    isInitializing,
    addProviderOpen = false,
    embedded = false,
    setupType = $bindable(null as StorageProviderType | null),
    githubPat = $bindable(''),
    githubRepo = $bindable(DEFAULT_GITHUB_REPO),
    onReconnect,
    onSyncProvider,
    onBeginAddProvider,
    onCancelAddProvider,
    onBeginSetup,
    onCancelSetup,
    onRemoveProvider,
    onLockVault,
  }: {
    vault: VaultState
    syncProviders: StorageProvider[]
    syncingProviderId?: string | null
    isAuthenticated: boolean
    isVerifying: boolean
    isInitializing: boolean
    addProviderOpen?: boolean
    embedded?: boolean
    setupType?: StorageProviderType | null
    githubPat: string
    githubRepo: string
    onReconnect: () => void | Promise<void>
    onSyncProvider?: (id: string) => void | Promise<void>
    onBeginAddProvider?: () => void
    onCancelAddProvider?: () => void
    onBeginSetup: (type: StorageProviderType) => void
    onCancelSetup: () => void
    onRemoveProvider?: (id: string) => void | Promise<void>
    onLockVault?: () => void
  } = $props()

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

  function formatSyncStatus(provider: StorageProvider): string {
    if (provider.lastSyncedAt) {
      const version =
        provider.lastSyncedVersion != null && provider.lastSyncedVersion > 0
          ? ` · v${provider.lastSyncedVersion}`
          : ''
      return `${vault.t('auth_storage.last_synced')}${version}`
    }
    return vault.t('auth_storage.not_synced_yet')
  }

  const showSetup = $derived(setupType !== null)
  const addingProvider = $derived(addProviderOpen || showSetup)
  const setupCanConnect = $derived(
    setupType !== 'oauth-file' || Boolean(vault.oauthFile?.accessToken?.trim()),
  )
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
                  : setupType === 'oauth-file'
                    ? vault.t('provider_picker.google_drive')
                    : vault.t('auth_storage.this_device'),
            })}
          {:else}
            {vault.t('settings.add_sync_provider')}
          {/if}
        </h2>
        <p class="text-xs text-muted-foreground text-pretty">
          {#if showSetup}
            {vault.t('auth_storage.sync_setup_desc')}
          {:else}
            {vault.t('auth_storage.sync_choose_desc')}
          {/if}
        </p>
      </div>
    </div>
  {:else if !embedded}
    <p class="text-xs text-muted-foreground text-pretty">
      {vault.t('auth_storage.sync_providers_desc')}
    </p>
  {/if}

  <div class="space-y-4">
    {#if isAuthenticated && onLockVault && !addingProvider}
      <div class="flex justify-end">
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          data-testid="lock-vault-btn"
          disabled={isVerifying || isInitializing}
          onclick={() => onLockVault()}
        >
          <Lock class="size-3.5" />
          {vault.t('common.lock_vault')}
        </button>
      </div>
    {/if}

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
        <ProviderPicker {vault} onSelect={onBeginSetup} excludeLocal />
      {:else}
        <fieldset class="space-y-2">
          {#if syncProviders.length === 0}
            <p
              class="text-xs text-muted-foreground"
              data-testid="sync-providers-empty"
            >
              {vault.t('auth_storage.no_sync_providers')}
            </p>
          {:else}
            <ul
              class="divide-y divide-border/60"
              data-testid="settings-providers-list"
            >
              {#each syncProviders as provider (provider.id)}
                <li class="flex items-center gap-2 py-2.5 first:pt-0 last:pb-0">
                  <div
                    class="flex min-w-0 flex-1 items-center gap-3 px-1 py-1"
                    data-testid="settings-provider-{provider.type}"
                  >
                    {#if provider.type === 'github' || provider.type === 'oauth-file'}
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
                      <span
                        class="block truncate text-[11px] text-muted-foreground"
                        data-testid="sync-status-{provider.id}"
                      >
                        {formatSyncStatus(provider)}
                      </span>
                    </span>
                  </div>
                  {#if onSyncProvider}
                    <button
                      type="button"
                      class="inline-flex shrink-0 items-center gap-1 rounded-md border border-border/60 px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-50"
                      data-testid="sync-provider-{provider.id}"
                      disabled={isVerifying ||
                        isInitializing ||
                        syncingProviderId !== null}
                      aria-busy={syncingProviderId === provider.id}
                      onclick={() => void onSyncProvider(provider.id)}
                    >
                      {#if syncingProviderId === provider.id}
                        <RefreshCw class="size-3.5 animate-spin" />
                      {:else}
                        <RefreshCw class="size-3.5" />
                      {/if}
                      {vault.t('auth_storage.sync_now')}
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
            {vault.t('settings.add_sync_provider')}
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
            disabled={!setupCanConnect}
          >
            {#if isInitializing}
              <RefreshCw class="size-4 animate-spin" />
              {vault.t('onboarding.loading_engine')}
            {:else if isVerifying}
              <RefreshCw class="size-4 animate-spin" />
              {vault.t('auth_storage.sync_connecting')}
            {:else}
              <ShieldCheck class="size-4" />
              {vault.t('auth_storage.connect_and_sync')}
            {/if}
          </Button>
        </div>
      {/if}
    </form>
  </div>
</div>
