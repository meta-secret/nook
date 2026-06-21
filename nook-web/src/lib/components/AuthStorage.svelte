<script lang="ts">
  import {
    GitBranch,
    ShieldCheck,
    RefreshCw,
    HardDrive,
    Cloud,
    CheckCircle2,
  } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import DeviceEnrollment from '$lib/components/DeviceEnrollment.svelte'
  import type { StorageProvider } from '$lib/auth-providers'
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
    successMsg,
    secretsCount,
    deviceId = '',
    devicePublicKey = '',
    pendingJoins = [] as JoinRequest[],
    vaultMembers = [] as VaultMember[],
    onReconnect,
    onSelectProvider,
    onInitializeEmpty,
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
    successMsg: string
    secretsCount: number
    deviceId?: string
    devicePublicKey?: string
    pendingJoins?: JoinRequest[]
    vaultMembers?: VaultMember[]
    onReconnect: () => void | Promise<void>
    onSelectProvider: (id: string) => void | Promise<void>
    onInitializeEmpty: () => void | Promise<void>
    onApproveJoin?: (deviceId: string) => void | Promise<void>
    onRefreshJoins?: () => void | Promise<void>
  } = $props()

  const activeProvider = $derived(
    providers.find((p) => p.id === activeProviderId) ?? null,
  )
</script>

<div class="w-full animate-in fade-in duration-300">
  <Card
    class="border-border bg-card/80 shadow-lg shadow-black/20 backdrop-blur-sm overflow-hidden"
  >
    <CardHeader class="border-b border-border/60 pb-4 pt-5">
      <div class="flex items-start justify-between gap-3">
        <div class="space-y-1">
          <CardTitle
            class="text-lg font-semibold tracking-tight text-foreground"
          >
            Storage & devices
          </CardTitle>
          <CardDescription>
            Manage saved providers and device enrollment. Tokens stay in this
            browser.
          </CardDescription>
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
      </div>
    </CardHeader>

    <CardContent class="pt-4 space-y-4">
      <fieldset class="space-y-2">
        <legend class="text-xs font-medium text-foreground">
          Saved providers
        </legend>
        {#if providers.length === 0}
          <p class="text-xs text-muted-foreground">
            No providers saved. Sign out and use the login screen to add one.
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
                  onclick={() => onSelectProvider(provider.id)}
                >
                  {#if provider.type === 'github'}
                    <Cloud class="size-4 shrink-0" />
                  {:else}
                    <HardDrive class="size-4 shrink-0" />
                  {/if}
                  <span class="min-w-0 flex-1 truncate font-medium">
                    {provider.label}
                  </span>
                  {#if provider.id === activeProviderId}
                    <span
                      class="shrink-0 text-[10px] font-medium uppercase tracking-wide text-primary"
                      >Active</span
                    >
                  {/if}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
        {#if activeProvider?.type === 'github'}
          <p class="text-[11px] text-muted-foreground">
            GitHub token saved in IndexedDB. Reconnect uses the stored token —
            no re-entry needed.
          </p>
        {/if}
      </fieldset>

      <form
        novalidate
        onsubmit={(e) => {
          e.preventDefault()
          void onReconnect()
        }}
        class="space-y-4"
      >
        {#if errorMsg}
          <div
            class="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            role="alert"
            data-testid="connect-error"
          >
            {errorMsg}
          </div>
        {/if}

        {#if successMsg}
          <div
            class="rounded-lg border border-primary/20 bg-primary/10 px-4 py-3 text-sm text-primary"
            role="status"
            data-testid="connect-success"
          >
            {successMsg}
          </div>
        {/if}

        <div
          class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end"
        >
          {#if isAuthenticated && secretsCount === 0}
            <Button
              type="button"
              variant="outline"
              onclick={onInitializeEmpty}
              disabled={isSaving}
              class="border-border text-foreground hover:bg-accent sm:mr-auto"
            >
              {#if isSaving}
                <RefreshCw class="size-4 animate-spin" />
              {:else}
                <GitBranch class="size-4" />
              {/if}
              Initialize empty vault
            </Button>
          {/if}

          <Button
            type="submit"
            class="sm:min-w-[180px]"
            data-testid="connect-vault-btn"
          >
            {#if isInitializing}
              <RefreshCw class="size-4 animate-spin" />
              Loading engine…
            {:else if isVerifying}
              <RefreshCw class="size-4 animate-spin" />
              Reconnecting…
            {:else}
              <ShieldCheck class="size-4" />
              Reconnect vault
            {/if}
          </Button>
        </div>
      </form>

      <DeviceEnrollment
        {deviceId}
        {devicePublicKey}
        {pendingJoins}
        {vaultMembers}
        isBusy={isVerifying || isSaving || isInitializing}
        {onApproveJoin}
        onRefresh={onRefreshJoins}
      />
    </CardContent>
  </Card>
</div>
