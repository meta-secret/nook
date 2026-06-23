<script lang="ts">
  import {
    ShieldCheck,
    RefreshCw,
    HardDrive,
    Cloud,
    CheckCircle2,
    Plus,
    ChevronLeft,
    ChevronDown,
  } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import ProviderPicker from '$lib/components/ProviderPicker.svelte'
  import ProviderSetupFields from '$lib/components/ProviderSetupFields.svelte'
  import DeviceEnrollment from '$lib/components/DeviceEnrollment.svelte'
  import VaultPasswordCard from '$lib/components/VaultPasswordCard.svelte'
  import type {
    StorageProvider,
    StorageProviderType,
  } from '$lib/auth-providers'
  import { DEFAULT_GITHUB_REPO } from '$lib/auth-providers'
  import type { JoinRequest, VaultMember } from '$lib/nook'

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
    hasPasswordEnvelope = false,
    isPasswordBusy = false,
    passwordError = '',
    enrollmentCode = '',
    onReconnect,
    onSelectProvider,
    onBeginAddProvider,
    onCancelAddProvider,
    onBeginSetup,
    onCancelSetup,
    onApproveJoin,
    onSetVaultPassword,
    onRemoveVaultPassword,
    onIssueEnrollmentCode,
    onClearEnrollmentCode,
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
    hasPasswordEnvelope?: boolean
    isPasswordBusy?: boolean
    passwordError?: string
    enrollmentCode?: string
    onReconnect: () => void | Promise<void>
    onSelectProvider: (id: string) => void | Promise<void>
    onBeginAddProvider?: () => void
    onCancelAddProvider?: () => void
    onBeginSetup: (type: StorageProviderType) => void
    onCancelSetup: () => void
    onApproveJoin?: (deviceId: string) => void | Promise<void>
    onSetVaultPassword?: (password: string) => void | Promise<void>
    onRemoveVaultPassword?: () => void | Promise<void>
    onIssueEnrollmentCode?: (password: string) => string | void
    onClearEnrollmentCode?: () => void
  } = $props()

  const showSetup = $derived(setupType !== null)
  const addingProvider = $derived(addProviderOpen || showSetup)
  let storageProvidersExpanded = $state(true)
</script>

<div class="w-full animate-in fade-in duration-300 space-y-5">
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
          Back to saved providers
        </button>
        <h2 class="text-base font-semibold text-foreground">
          {#if showSetup}
            Connect to {setupType === 'github' ? 'GitHub' : 'this device'}
          {:else}
            Add storage provider
          {/if}
        </h2>
        <p class="text-xs text-muted-foreground text-pretty">
          {#if showSetup}
            Connect and save this provider in this browser. Only the active
            provider is used for sync until you switch.
          {:else}
            Pick where to store another encrypted vault file. Each provider can
            point at a different vault.
          {/if}
        </p>
      </div>
    </div>
  {:else}
    <button
      type="button"
      class="flex w-full items-start justify-between gap-3 border-b border-border/60 pb-4 text-left group transition-colors focus:outline-hidden"
      onclick={() => (storageProvidersExpanded = !storageProvidersExpanded)}
    >
      <div class="space-y-1">
        <h2
          class="text-base font-semibold text-foreground inline-flex items-center gap-1.5 group-hover:text-primary transition-colors"
        >
          Vault info
          <ChevronDown
            class="size-4 text-muted-foreground transition-transform duration-200 {storageProvidersExpanded
              ? 'rotate-180'
              : ''}"
          />
        </h2>
        <p class="text-xs text-muted-foreground text-pretty">
          Configure storage providers, enrolled devices, and browser
          authorization.
        </p>
      </div>
      {#if isAuthenticated}
        <span
          class="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-500"
          data-testid="connected-badge"
        >
          <CheckCircle2 class="size-3" />
          Connected
        </span>
      {/if}
    </button>
  {/if}

  {#if storageProvidersExpanded || addingProvider}
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
              <ul class="space-y-2.5" data-testid="settings-providers-list">
                {#each providers as provider (provider.id)}
                  <li>
                    <button
                      type="button"
                      class="group flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-left transition-all duration-200 {provider.id ===
                      activeProviderId
                        ? 'border-primary/30 bg-primary/5 shadow-xs'
                        : 'border-border bg-card hover:bg-accent/40 hover:border-border/80 hover:shadow-xs'}"
                      data-testid="settings-provider-{provider.type}"
                      disabled={isVerifying || isInitializing}
                      aria-busy={isVerifying &&
                        provider.id === activeProviderId}
                      onclick={() => void onSelectProvider(provider.id)}
                    >
                      <div class="flex items-center gap-3 min-w-0">
                        <div
                          class="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/40 bg-background/60 text-primary"
                        >
                          {#if provider.type === 'github'}
                            <Cloud class="size-4.5" />
                          {:else}
                            <HardDrive class="size-4.5" />
                          {/if}
                        </div>
                        <div class="flex flex-col min-w-0">
                          <span
                            class="font-medium text-foreground text-sm truncate"
                          >
                            {provider.label}
                          </span>
                          <span
                            class="text-xs text-muted-foreground truncate mt-0.5"
                          >
                            {#if provider.type === 'github'}
                              {provider.githubRepo ?? DEFAULT_GITHUB_REPO}
                            {:else}
                              IndexedDB browser storage
                            {/if}
                          </span>
                        </div>
                      </div>

                      <div class="shrink-0 flex items-center gap-2">
                        {#if provider.id === activeProviderId}
                          {#if isVerifying}
                            <span
                              class="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-xs text-primary"
                            >
                              <RefreshCw class="size-3 animate-spin" />
                              Connecting
                            </span>
                          {:else}
                            <span
                              class="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400"
                            >
                              <CheckCircle2 class="size-3" />
                              Active
                            </span>
                          {/if}
                        {:else}
                          <span
                            class="text-xs font-medium text-primary opacity-0 group-hover:opacity-100 transition-opacity duration-200 mr-1"
                          >
                            Switch
                          </span>
                        {/if}
                      </div>
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}

            <div class="pt-1.5">
              <button
                type="button"
                class="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border/80 bg-muted/20 py-3.5 text-sm font-medium text-muted-foreground transition-all duration-200 hover:bg-accent/50 hover:text-foreground hover:border-border hover:shadow-xs"
                data-testid="add-provider-btn"
                onclick={() => onBeginAddProvider?.()}
              >
                <Plus class="size-4 text-muted-foreground" />
                Add storage provider
              </button>
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
    </div>
  {/if}

  {#if !addingProvider}
    {#if isAuthenticated && onSetVaultPassword && onRemoveVaultPassword && onIssueEnrollmentCode && onClearEnrollmentCode}
      <hr class="border-border/60" />
      <VaultPasswordCard
        {hasPasswordEnvelope}
        isBusy={isPasswordBusy}
        {passwordError}
        {enrollmentCode}
        onSetPassword={onSetVaultPassword}
        onRemovePassword={onRemoveVaultPassword}
        onIssueCode={onIssueEnrollmentCode}
        onClearCode={onClearEnrollmentCode}
      />
    {/if}

    <hr class="border-border/60" />
    <DeviceEnrollment
      {deviceId}
      {devicePublicKey}
      {pendingJoins}
      {vaultMembers}
      isBusy={isSaving || isVerifying}
      {onApproveJoin}
    />
  {/if}
</div>
