<script lang="ts">
  import { I18N_KEYS } from '../../../generated/i18n-keys'
  import {
    HardDrive,
    RefreshCw,
    ShieldCheck,
    TriangleAlert,
  } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import { NookVaultLastSyncState, type NookVaultLastSync } from '$app-wasm'
  import { SyncProviderLabelKind, type VaultState } from '$lib/vault.svelte'
  import { VaultStatusBarVariant } from './vault-status-bar-state'

  let {
    vault,
    lastSync,
    isSyncing = false,
    successMsg = '',
    errorMsg = '',
    appVersion = '',
    label,
    showSyncStatus = true,
    showStorageIcon = true,
    variant = VaultStatusBarVariant.Panel,
    onRefresh,
    onDismissSuccess,
    onDismissError,
  }: {
    vault?: VaultState
    lastSync: NookVaultLastSync
    isSyncing?: boolean
    successMsg?: string
    errorMsg?: string
    appVersion?: string
    label?: string
    showSyncStatus?: boolean
    showStorageIcon?: boolean
    variant?: VaultStatusBarVariant
    onRefresh?: () => void | Promise<void>
    onDismissSuccess?: () => void
    onDismissError?: () => void
  } = $props()

  let now = $state(Date.now())

  $effect(() => {
    const timer = setInterval(() => {
      now = Date.now()
    }, 1000)
    return () => clearInterval(timer)
  })

  function formatLastSync(sync: NookVaultLastSync): string {
    if (sync.state === NookVaultLastSyncState.NeverSynced) {
      return vault ? vault.t(I18N_KEYS.StatusBarNotYet) : 'not yet'
    }
    const secs = Math.max(
      0,
      Math.floor((now - sync.syncedAtUnixMilliseconds) / 1000),
    )
    if (secs < 5)
      return vault ? vault.t(I18N_KEYS.StatusBarJustNow) : 'just now'
    if (secs < 60)
      return vault
        ? (() => {
            const translationRequest: Parameters<typeof vault.t>[0] = {
              key: I18N_KEYS.StatusBarSecsAgo,
              replacements: { secs: String(secs) },
            }
            return vault.t(translationRequest)
          })()
        : `${secs}s ago`
    const mins = Math.floor(secs / 60)
    if (mins < 60)
      return vault
        ? (() => {
            const translationRequest2: Parameters<typeof vault.t>[0] = {
              key: I18N_KEYS.StatusBarMinsAgo,
              replacements: { mins: String(mins) },
            }
            return vault.t(translationRequest2)
          })()
        : `${mins}m ago`
    return vault
      ? (() => {
          const translationRequest3: Parameters<typeof vault.t>[0] = {
            key: I18N_KEYS.StatusBarHoursAgo,
            replacements: {
              hours: String(Math.floor(mins / 60)),
            },
          }
          return vault.t(translationRequest3)
        })()
      : `${Math.floor(mins / 60)}h ago`
  }

  const isAuthenticatedVault = $derived(Boolean(vault?.isAuthenticated))
  const isQuiet = $derived(variant === VaultStatusBarVariant.Quiet)

  const statusLabel = $derived(
    ((
      ...[
        v = isAuthenticatedVault
          ? vault
            ? vault.t(I18N_KEYS.StatusBarLocalVault)
            : label || 'Nook'
          : vault
            ? vault.t(I18N_KEYS.ProviderPickerThisDevice)
            : 'This device',
      ]
    ) => v)(label),
  )

  const syncDetail = $derived.by(() => {
    if (!vault || !showSyncStatus) return ''
    if (vault.syncingProviderLabel.kind === SyncProviderLabelKind.Active) {
      const translationRequest4: Parameters<typeof vault.t>[0] = {
        key: I18N_KEYS.StatusBarSyncingTo,
        replacements: {
          provider: vault.syncingProviderLabel.label,
        },
      }
      return vault.t(translationRequest4)
    }
    if (vault.isFanOutSyncing) {
      return vault.t(I18N_KEYS.StatusBarSyncingProviders)
    }
    if (vault.syncProviderCount > 0) {
      return vault.syncProviderCount === 1
        ? vault.t(I18N_KEYS.StatusBarSyncProvidersSingular)
        : (() => {
            const translationRequest5: Parameters<typeof vault.t>[0] = {
              key: I18N_KEYS.StatusBarSyncProvidersPlural,
              replacements: {
                count: String(vault.syncProviderCount),
              },
            }
            return vault.t(translationRequest5)
          })()
    }
    return vault.t(I18N_KEYS.StatusBarSavedLocalOnly)
  })

  const showRefresh = $derived(
    Boolean(
      onRefresh && isAuthenticatedVault,
    ),
  )
</script>

<div
  class={isQuiet
    ? 'border-t border-border px-1 py-2.5 font-mono'
    : 'border-t border-border px-1 py-2.5 font-mono'}
  data-testid="vault-status-bar"
>
  <div class="flex flex-col gap-2">
    <div
      class={isQuiet
        ? 'flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-[11px]'
        : 'flex items-center justify-between gap-x-3 gap-y-2 text-[11px] sm:flex-wrap'}
    >
      <div class="flex min-w-0 items-center gap-2 text-muted-foreground">
        {#if showStorageIcon}
          {#if isAuthenticatedVault}
            <HardDrive
              class="size-3.5 shrink-0 text-primary/80"
              aria-hidden="true"
            />
          {:else}
            <HardDrive
              class="size-3.5 shrink-0 text-primary/80"
              aria-hidden="true"
            />
          {/if}
        {/if}
        <span class="truncate font-medium text-foreground">{statusLabel}</span>
        {#if appVersion}
          <span
            class="hidden text-muted-foreground sm:inline"
            aria-hidden="true">·</span
          >
          <span class="hidden shrink-0 text-muted-foreground/80 sm:inline">
            v{appVersion}
          </span>
        {/if}
        {#if showSyncStatus && isAuthenticatedVault}
          <span
            class="hidden text-muted-foreground sm:inline"
            aria-hidden="true">·</span
          >
          <span
            class="shrink-0 text-muted-foreground"
            data-testid="vault-last-sync"
          >
            {vault ? vault.t(I18N_KEYS.StatusBarSaved) : 'Saved'}
            {formatLastSync(lastSync)}
          </span>
          {#if syncDetail}
            <span
              class="hidden text-muted-foreground sm:inline"
              aria-hidden="true">·</span
            >
            <span
              class="min-w-0 truncate text-muted-foreground sm:shrink-0"
              data-testid="vault-sync-out-status"
              class:animate-pulse={vault?.isSyncActivityVisible}
            >
              {syncDetail}
            </span>
          {/if}
        {:else if showSyncStatus}
          <span
            class="hidden text-muted-foreground sm:inline"
            aria-hidden="true">·</span
          >
          <span
            class="shrink-0 text-muted-foreground"
            data-testid="vault-last-sync"
          >
            {vault ? vault.t(I18N_KEYS.StatusBarSaved) : 'Saved'}
            {formatLastSync(lastSync)}
          </span>
        {/if}
      </div>

      {#if showRefresh}
        <div class="group relative inline-block">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            class="h-7 shrink-0 px-2 text-xs text-muted-foreground hover:text-foreground"
            disabled={isSyncing}
            data-testid="vault-sync-refresh-btn"
            aria-label={isAuthenticatedVault
              ? vault
                ? vault.t(I18N_KEYS.StatusBarSyncAllAria)
                : 'Synchronize vault'
              : vault
                ? vault.t(I18N_KEYS.StatusBarRefreshAriaLocal)
                : 'Refresh vault from browser storage'}
            onclick={() => void onRefresh?.()}
          >
            <RefreshCw class="size-3.5 {isSyncing ? 'animate-spin' : ''}" />
            <span class="ml-1 hidden sm:inline"
              >{isAuthenticatedVault
                ? vault
                  ? vault.t(I18N_KEYS.StatusBarSyncAll)
                  : 'Sync'
                : vault
                  ? vault.t(I18N_KEYS.StatusBarRefresh)
                  : 'Refresh'}</span
            >
          </Button>
          <div
            class="pointer-events-none absolute bottom-full right-0 z-50 mb-2 rounded-md border border-border bg-popover px-2.5 py-1 text-[11px] font-medium text-popover-foreground opacity-0 shadow-md transition-opacity duration-200 group-hover:opacity-100 whitespace-nowrap"
            role="tooltip"
          >
            {isAuthenticatedVault
              ? vault
                ? vault.t(I18N_KEYS.StatusBarSyncAllTooltip)
                : 'Synchronize vault'
              : vault
                ? vault.t(I18N_KEYS.StatusBarRefreshTooltipLocal)
                : 'Reload latest changes from browser storage'}
          </div>
        </div>
      {/if}
    </div>

    {#if successMsg}
      <div
        class="nk-banner nk-banner-success flex items-center gap-2 px-2.5 py-1.5 font-sans text-xs text-foreground"
        role="status"
        data-testid="app-success"
      >
        <ShieldCheck class="size-3.5 shrink-0 text-success" />
        <span class="min-w-0 flex-1 truncate">{successMsg}</span>
        {#if onDismissSuccess}
          <button
            type="button"
            class="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
            aria-label={vault
              ? vault.t(I18N_KEYS.CommonDismissSuccess)
              : 'Dismiss success message'}
            data-testid="dismiss-success-btn"
            onclick={onDismissSuccess}
          >
            ×
          </button>
        {/if}
      </div>
    {/if}

    {#if errorMsg}
      <div
        class="nk-banner flex items-center gap-2 border-l-destructive bg-destructive/5 px-2.5 py-1.5 font-sans text-xs text-destructive"
        role="alert"
        data-testid="vault-error"
      >
        <TriangleAlert class="size-3.5 shrink-0" />
        <span class="min-w-0 flex-1 truncate">{errorMsg}</span>
        {#if onDismissError}
          <button
            type="button"
            class="shrink-0 rounded p-0.5 text-destructive/70 hover:text-destructive"
            aria-label={vault
              ? vault.t(I18N_KEYS.CommonDismissError)
              : 'Dismiss error message'}
            data-testid="dismiss-error-btn"
            onclick={onDismissError}
          >
            ×
          </button>
        {/if}
      </div>
    {/if}
  </div>
</div>
