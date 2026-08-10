<script lang="ts">
  import { I18N_KEYS } from '../../../generated/i18n-keys'
  import {
    NookManualProviderSyncState,
    type NookManualProviderSync,
  } from '$app-wasm'
  import {
    ShieldCheck,
    RefreshCw,
    HardDrive,
    Cloud,
    Plus,
    ChevronLeft,
    Trash2,
  } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import ProviderPicker from '$lib/components/ProviderPicker.svelte'
  import ProviderSetupFields from '$lib/components/ProviderSetupFields.svelte'
  import OAuthProviderSetupWizard from '$lib/components/OAuthProviderSetupWizard.svelte'
  import GitHubProviderSetupWizard from '$lib/components/GitHubProviderSetupWizard.svelte'
  import LocalFolderProviderSetupWizard from '$lib/components/LocalFolderProviderSetupWizard.svelte'
  import type {
    ProviderSetupRequest,
    StorageProvider,
    StorageProviderType,
  } from '$lib/auth/providers'
  import {
    DEFAULT_GITHUB_REPO,
    GITHUB_PROVIDER_TYPE,
    localFolderHandle,
    LocalFolderHandleKind,
    localizeProviderLabel,
    oauthAccessToken,
    OAuthAccessTokenKind,
    OAUTH_FILE_PROVIDER_TYPE,
    providerStorageDetail,
  } from '$lib/auth/providers'
  import type { VaultState } from '$lib/vault.svelte'
  import {
    providerCapabilityLabelKey,
    providerSupportsReplication,
  } from '$lib/vault/architecture-model'
  import { formatProviderSyncStatus } from '$lib/auth/provider-sync-status'
  import {
    LocalFolderDraftKind,
    LoginSetupKind,
    OAuthFileDraftKind,
    OAuthSetupPresetKind,
    type LoginSetup,
  } from '$lib/vault/state/provider.svelte'

  let {
    vault,
    syncProviders,
    manualProviderSync,
    isVerifying,
    isInitializing,
    addProviderOpen = false,
    embedded = false,
    loginSetup,
    githubPat = $bindable(''),
    githubRepo = $bindable(DEFAULT_GITHUB_REPO),
    onReconnect,
    onSyncProvider,
    onBeginAddProvider,
    onCancelAddProvider,
    onBeginSetup,
    onCancelSetup,
    onRemoveProvider,
  }: {
    vault: VaultState
    syncProviders: StorageProvider[]
    manualProviderSync: NookManualProviderSync
    isVerifying: boolean
    isInitializing: boolean
    addProviderOpen?: boolean
    embedded?: boolean
    loginSetup: LoginSetup
    githubPat: string
    githubRepo: string
    onReconnect: () => void | Promise<void>
    onSyncProvider?: (id: string) => void | Promise<void>
    onBeginAddProvider?: () => void
    onCancelAddProvider?: () => void
    onBeginSetup: (request: ProviderSetupRequest) => void
    onCancelSetup: () => void
    onRemoveProvider?: (id: string) => void | Promise<void>
  } = $props()

  function confirmRemoveProvider(provider: StorageProvider) {
    if (!onRemoveProvider) return
    const tArgs: Parameters<typeof vault.t>[0] = { key: I18N_KEYS.AuthStorageConfirmRemove, replacements: {
        label: provider.label,
        signedOutNote: '',
      } };
    const ok = confirm(
      vault.t(tArgs),
    )
    if (ok) {
      void onRemoveProvider(provider.id)
    }
  }

  function formatSyncStatus(provider: StorageProvider): string {
    const formatProviderSyncStatusArgs: Parameters<typeof formatProviderSyncStatus>[0] = { provider, locale: vault.locale, labels: {
      lastSynced: vault.t(I18N_KEYS.AuthStorageLastSynced),
      notSyncedYet: vault.t(I18N_KEYS.AuthStorageNotSyncedYet),
    } };
    return formatProviderSyncStatus(formatProviderSyncStatusArgs)
  }

  const showSetup = $derived(loginSetup.kind === LoginSetupKind.Active)
  const addingProvider = $derived(addProviderOpen || showSetup)
  function setupIs(type: StorageProviderType): boolean {
    return (
      loginSetup.kind === LoginSetupKind.Active &&
      loginSetup.providerType === type
    )
  }
  const setupCanConnect = $derived(
    setupIs('local') ||
      (setupIs('local-folder') &&
        vault.localFolderDraft.kind === LocalFolderDraftKind.Configured &&
        localFolderHandle(vault.localFolderDraft.config).kind ===
          LocalFolderHandleKind.Selected) ||
      (setupIs('oauth-file') &&
        vault.oauthFileDraft.kind === OAuthFileDraftKind.Configured &&
        oauthAccessToken(vault.oauthFileDraft.config).kind ===
          OAuthAccessTokenKind.Available) ||
      (setupIs('github') && Boolean(githubPat.trim())),
  )
  const oauthPreset = $derived(
    vault.oauthFileDraft.kind === OAuthFileDraftKind.Configured
      ? vault.oauthFileDraft.config.preset
      : vault.oauthSetupSelection.kind === OAuthSetupPresetKind.Selected
        ? vault.oauthSetupSelection.preset
        : 'google-drive',
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
          {vault.t(I18N_KEYS.OnboardingBackToSaved)}
        </button>
        <h2 class="text-base font-semibold text-foreground">
          {#if showSetup}
            {(() => { const tArgs2: Parameters<typeof vault.t>[0] = { key: I18N_KEYS.AuthStorageConnectToType, replacements: {
              type: setupIs('github')
                ? vault.t(I18N_KEYS.AuthStorageGithub)
                : setupIs('oauth-file')
                  ? vault.t(I18N_KEYS.ProviderPickerGoogleDrive)
                  : setupIs('local-folder')
                    ? vault.t(I18N_KEYS.ProviderPickerLocalFolder)
                    : vault.t(I18N_KEYS.AuthStorageThisDevice),
            } }; return vault.t(tArgs2); })()}
          {:else}
            {vault.t(I18N_KEYS.SettingsAddSyncProvider)}
          {/if}
        </h2>
        <p class="text-xs text-muted-foreground text-pretty">
          {#if showSetup}
            {vault.t(I18N_KEYS.AuthStorageSyncSetupDesc)}
          {:else}
            {vault.t(I18N_KEYS.AuthStorageSyncChooseDesc)}
          {/if}
        </p>
      </div>
    </div>
  {:else if !embedded}
    <p class="text-xs text-muted-foreground text-pretty">
      {vault.t(I18N_KEYS.AuthStorageSyncProvidersDesc)}
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
        {#if setupIs('oauth-file')}
          <OAuthProviderSetupWizard
            {vault}
            bind:githubRepo
            idPrefix="settings"
            preset={oauthPreset}
            {isVerifying}
            {isInitializing}
            {onCancelSetup}
            onConnect={onReconnect}
          />
        {:else if setupIs('github')}
          <GitHubProviderSetupWizard
            {vault}
            bind:githubPat
            bind:githubRepo
            idPrefix="settings"
            {isVerifying}
            {isInitializing}
            {onCancelSetup}
            onConnect={onReconnect}
          />
        {:else if setupIs('local-folder')}
          <LocalFolderProviderSetupWizard
            {vault}
            idPrefix="settings"
            {isVerifying}
            {isInitializing}
            {onCancelSetup}
            onConnect={onReconnect}
          />
        {:else}
          <ProviderSetupFields {vault} {onCancelSetup} />
        {/if}
      {:else if addProviderOpen}
        <ProviderPicker {vault} onSelect={onBeginSetup} excludeLocal />
      {:else}
        <fieldset class="space-y-3">
          {#if syncProviders.length === 0}
            <div
              class="rounded-lg border border-dashed border-border/50 bg-muted/10 px-4 py-4"
              data-testid="sync-providers-empty"
            >
              <div class="flex items-start gap-3">
                <div
                  class="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/40 bg-background/60 text-muted-foreground"
                >
                  <Cloud class="size-4" />
                </div>
                <div class="min-w-0 space-y-1">
                  <p class="text-sm font-medium text-foreground">
                    {vault.t(I18N_KEYS.AuthStorageNoSyncProviders)}
                  </p>
                  <p class="text-xs text-pretty text-muted-foreground">
                    {vault.t(I18N_KEYS.AuthStorageSyncProvidersDesc)}
                  </p>
                </div>
              </div>
              <div class="mt-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="add-provider-btn"
                  onclick={() => onBeginAddProvider?.()}
                >
                  <Plus class="size-4" />
                  {vault.t(I18N_KEYS.SettingsAddSyncProvider)}
                </Button>
              </div>
            </div>
          {:else}
            <ul
              class="divide-y divide-border/60"
              data-testid="settings-providers-list"
            >
              {#each syncProviders as provider (provider.id)}
                {@const supportsVaultReplication = providerSupportsReplication(
                  provider,
                  vault.vaultArchitecture.replication_type,
                )}
                <li class="flex items-center gap-2 py-2.5 first:pt-0 last:pb-0">
                  <div
                    class="flex min-w-0 flex-1 items-center gap-3 px-1 py-1"
                    data-testid="settings-provider-{provider.type}"
                  >
                    {#if provider.type === GITHUB_PROVIDER_TYPE || provider.type === OAUTH_FILE_PROVIDER_TYPE}
                      <Cloud class="size-4 shrink-0 text-primary" />
                    {:else}
                      <HardDrive class="size-4 shrink-0 text-primary" />
                    {/if}
                    <span class="min-w-0 flex-1">
                      <span class="block truncate font-medium text-sm">
                        {(() => { const localizeProviderLabelArgs: Parameters<typeof localizeProviderLabel>[0] = { label: provider.label, t: vault.t }; return localizeProviderLabel(localizeProviderLabelArgs); })()}
                      </span>
                      <span
                        class="block truncate text-xs text-muted-foreground"
                      >
                        {(() => { const providerStorageDetailArgs: Parameters<typeof providerStorageDetail>[0] = { provider, t: vault.t }; return providerStorageDetail(providerStorageDetailArgs); })()}
                      </span>
                      <span
                        class="block truncate text-[11px] text-muted-foreground"
                        data-testid="sync-status-{provider.id}"
                      >
                        {formatSyncStatus(provider)}
                      </span>
                      <span
                        class="block text-[11px] {supportsVaultReplication
                          ? 'text-muted-foreground'
                          : 'text-amber-700 dark:text-amber-300'}"
                        data-testid="provider-capability-{provider.id}"
                      >
                        {vault.t(providerCapabilityLabelKey(provider))}
                        {#if !supportsVaultReplication}
                          · {vault.t(
                            I18N_KEYS.ProviderPickerUnsupportedCurrentVault,
                          )}
                        {/if}
                      </span>
                    </span>
                  </div>
                  {#if onSyncProvider}
                    {@const providerSyncing =
                      manualProviderSync.state ===
                        NookManualProviderSyncState.Running &&
                      manualProviderSync.providerId === provider.id}
                    <button
                      {...!supportsVaultReplication
                        ? {
                            title: vault.t(
                              I18N_KEYS.ProviderPickerUnsupportedCurrentVault,
                            ),
                          }
                        : {}}
                      type="button"
                      class="inline-flex shrink-0 items-center gap-1 rounded-md border border-border/60 px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-50"
                      data-testid="sync-provider-{provider.id}"
                      disabled={isVerifying ||
                        isInitializing ||
                        !supportsVaultReplication ||
                        manualProviderSync.state ===
                          NookManualProviderSyncState.Running}
                      aria-busy={providerSyncing}
                      onclick={() => void onSyncProvider(provider.id)}
                    >
                      {#if providerSyncing}
                        <RefreshCw class="size-3.5 animate-spin" />
                      {:else}
                        <RefreshCw class="size-3.5" />
                      {/if}
                      {vault.t(I18N_KEYS.AuthStorageSyncNow)}
                    </button>
                  {/if}
                  {#if onRemoveProvider}
                    <button
                      type="button"
                      class="inline-flex shrink-0 items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                      aria-label="{vault.t(
                        I18N_KEYS.CommonRemove,
                      )} {(() => { const localizeProviderLabelArgs2: Parameters<typeof localizeProviderLabel>[0] = { label: provider.label, t: vault.t }; return localizeProviderLabel(localizeProviderLabelArgs2); })()}"
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

            <button
              type="button"
              class="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              data-testid="add-provider-btn"
              onclick={() => onBeginAddProvider?.()}
            >
              <Plus class="size-4" />
              {vault.t(I18N_KEYS.SettingsAddSyncProvider)}
            </button>
          {/if}
        </fieldset>
      {/if}

      {#if showSetup && setupIs('local')}
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
              {vault.t(I18N_KEYS.OnboardingLoadingEngine)}
            {:else if isVerifying}
              <RefreshCw class="size-4 animate-spin" />
              {vault.t(I18N_KEYS.AuthStorageSyncConnecting)}
            {:else}
              <ShieldCheck class="size-4" />
              {vault.t(I18N_KEYS.AuthStorageConnectAndSync)}
            {/if}
          </Button>
        </div>
      {/if}
    </form>
  </div>
</div>
