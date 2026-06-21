<script lang="ts">
  import {
    GitBranch,
    ShieldCheck,
    RefreshCw,
    HardDrive,
    Cloud,
    CheckCircle2,
    ExternalLink,
  } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import DeviceEnrollment from '$lib/components/DeviceEnrollment.svelte'
  import type { JoinRequest, VaultMember } from '$lib/nook'
  import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
  } from '$lib/components/ui/card'

  let {
    storageMode = $bindable(),
    githubPat = $bindable(),
    enrollSecretsKey = $bindable(''),
    enrollMembersKey = $bindable(''),
    variant = 'welcome',
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
    onConnect,
    onInitializeEmpty,
    onApproveJoin,
    onEnrollWithDec,
    onRefreshJoins,
  }: {
    storageMode: 'local' | 'github'
    githubPat: string
    enrollSecretsKey?: string
    enrollMembersKey?: string
    variant?: 'welcome' | 'panel'
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
    onConnect: () => void | Promise<void>
    onInitializeEmpty: () => void | Promise<void>
    onApproveJoin?: (deviceId: string) => void | Promise<void>
    onEnrollWithDec?: () => void | Promise<void>
    onRefreshJoins?: () => void | Promise<void>
  } = $props()

  const githubPatUrl =
    'https://github.com/settings/tokens/new?scopes=repo&description=nook'
</script>

<div class="w-full animate-in fade-in duration-300">
  <Card class="border-border bg-card/80 shadow-lg shadow-black/20 backdrop-blur-sm overflow-hidden">
    <CardHeader class="border-b border-border/60 {variant === 'welcome' ? 'pb-4 pt-5' : 'pb-4 pt-5'}">
      <div class="flex items-start justify-between gap-3">
        <div class="space-y-1">
          {#if variant === 'welcome'}
            <CardTitle class="text-lg font-semibold tracking-tight text-foreground">
              Unlock your vault
            </CardTitle>
            <CardDescription>
              Pick where secrets sync. Your encryption key stays in this browser.
            </CardDescription>
          {:else}
            <CardTitle class="text-lg font-semibold tracking-tight text-foreground">
              Storage settings
            </CardTitle>
            <CardDescription>
              Change provider or reconnect your vault.
            </CardDescription>
          {/if}
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

    <CardContent class="pt-4">
      <form
        novalidate
        onsubmit={(e) => {
          e.preventDefault()
          void onConnect()
        }}
        class="space-y-4"
      >
        <fieldset class="space-y-2">
          <legend class="sr-only">Storage target</legend>
          <div
            class="flex rounded-lg border border-border bg-muted/40 p-0.5"
            id="storage-mode-select"
          >
            <button
              type="button"
              aria-pressed={storageMode === 'local'}
              class="flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-all {storageMode ===
              'local'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'}"
              onclick={() => (storageMode = 'local')}
            >
              <HardDrive class="size-3.5 shrink-0" />
              Local
            </button>
            <button
              type="button"
              aria-pressed={storageMode === 'github'}
              class="flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-all {storageMode ===
              'github'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'}"
              onclick={() => (storageMode = 'github')}
            >
              <Cloud class="size-3.5 shrink-0" />
              GitHub
            </button>
          </div>
          <p class="text-xs text-muted-foreground">
            {#if storageMode === 'github'}
              Syncs encrypted vault to
              <span class="font-mono text-foreground/80">username/nook</span>.
              Key never leaves this browser.
            {:else}
              Stored in IndexedDB on this device. No sign-in required.
            {/if}
          </p>
        </fieldset>

        {#if storageMode === 'github'}
          <div
            class="space-y-4 rounded-lg border border-border bg-muted/30 p-3 animate-in fade-in slide-in-from-top-1 duration-200"
          >
            <ol class="space-y-4">
              <li class="flex gap-3">
                <span
                  class="flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-background text-[10px] font-semibold text-muted-foreground"
                  aria-hidden="true"
                >1</span>
                <div class="min-w-0 flex-1 space-y-1.5">
                  <p class="text-xs font-medium text-foreground">
                    Create a token on GitHub
                  </p>
                  <p class="text-[11px] leading-relaxed text-muted-foreground">
                    Classic <span class="font-mono">ghp_</span> token with
                    <span class="font-mono">repo</span> scope.
                  </p>
                  <a
                    href={githubPatUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="github-new-token-btn"
                    class="inline-flex items-center gap-1 text-xs font-medium text-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-foreground"
                  >
                    Open token settings
                    <ExternalLink class="size-3 shrink-0 opacity-70" />
                  </a>
                </div>
              </li>

              <li class="flex gap-3">
                <span
                  class="flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-background text-[10px] font-semibold text-muted-foreground"
                  aria-hidden="true"
                >2</span>
                <div class="min-w-0 flex-1 space-y-1.5">
                  <label class="text-xs font-medium text-foreground" for="pat">
                    Paste token here
                  </label>
                  <input
                    id="pat"
                    type="password"
                    bind:value={githubPat}
                    placeholder="ghp_xxxxxxxxxxxx"
                    autocomplete="off"
                    class="flex h-9 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-hidden focus:ring-2 focus:ring-ring"
                  />
                  <p class="text-[11px] text-muted-foreground">
                    Syncs to
                    <span class="font-mono text-foreground/80">username/nook/nook-vault.yaml</span>
                  </p>
                </div>
              </li>
            </ol>
          </div>
        {/if}

        {#if variant === 'welcome'}
          <DeviceEnrollment
            {deviceId}
            {devicePublicKey}
            {pendingJoins}
            {vaultMembers}
            isBusy={isVerifying || isSaving || isInitializing}
            bind:enrollSecretsKey
            bind:enrollMembersKey
            onApproveJoin={onApproveJoin}
            onEnrollWithDec={onEnrollWithDec}
            onRefresh={onRefreshJoins}
          />
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

        {#if successMsg}
          <div
            class="rounded-lg border border-primary/20 bg-primary/10 px-4 py-3 text-sm text-primary"
            role="status"
            data-testid="connect-success"
          >
            {successMsg}
          </div>
        {/if}

        <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
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
              Connecting…
            {:else if isAuthenticated}
              <ShieldCheck class="size-4" />
              Reconnect
            {:else}
              <ShieldCheck class="size-4" />
              Connect vault
            {/if}
          </Button>
        </div>
      </form>

      {#if variant !== 'welcome'}
        <div class="mt-4">
          <DeviceEnrollment
            {deviceId}
            {devicePublicKey}
            {pendingJoins}
            {vaultMembers}
            isBusy={isVerifying || isSaving || isInitializing}
            bind:enrollSecretsKey
            bind:enrollMembersKey
            onApproveJoin={onApproveJoin}
            onEnrollWithDec={onEnrollWithDec}
            onRefresh={onRefreshJoins}
          />
        </div>
      {/if}
    </CardContent>
  </Card>
</div>
