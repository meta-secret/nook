<script lang="ts">
  import {
    Server,
    GitBranch,
    ShieldCheck,
    RefreshCw,
    HardDrive,
    Cloud,
    CheckCircle2,
    ExternalLink,
  } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
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
    isAuthenticated,
    isVerifying,
    isSaving,
    isInitializing,
    errorMsg,
    successMsg,
    secretsCount,
    onConnect,
    onInitializeEmpty,
  }: {
    storageMode: 'local' | 'github'
    githubPat: string
    isAuthenticated: boolean
    isVerifying: boolean
    isSaving: boolean
    isInitializing: boolean
    errorMsg: string
    successMsg: string
    secretsCount: number
    onConnect: () => void | Promise<void>
    onInitializeEmpty: () => void | Promise<void>
  } = $props()

  const githubPatUrl =
    'https://github.com/settings/tokens/new?scopes=repo&description=nook'
</script>

<div class="mx-auto max-w-xl animate-in fade-in duration-300">
  <div class="mb-5 space-y-1.5 text-center">
    <h1 class="text-2xl font-semibold tracking-tight text-foreground">
      Connect your vault
    </h1>
    <p class="text-sm leading-relaxed text-muted-foreground">
      Pick where encrypted secrets live. Your key stays in this browser —
      never on GitHub.
    </p>
  </div>

  <Card class="border-border bg-card/80 shadow-lg shadow-black/20 backdrop-blur-sm">
    <CardHeader class="pb-4">
      <div class="flex items-start justify-between gap-4">
        <div class="space-y-1">
          <CardTitle class="text-base font-medium text-foreground"
            >Storage provider</CardTitle
          >
          <CardDescription class="text-muted-foreground">
            Switch anytime — your encryption key remains local.
          </CardDescription>
        </div>
        {#if isAuthenticated}
          <span
            class="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-500"
            data-testid="connected-badge"
          >
            <CheckCircle2 class="size-3.5" />
            Connected
          </span>
        {/if}
      </div>
    </CardHeader>

    <CardContent>
      <form
        novalidate
        onsubmit={(e) => {
          e.preventDefault()
          void onConnect()
        }}
        class="space-y-6"
      >
        <fieldset class="space-y-3">
          <legend class="sr-only">Storage target</legend>
          <div class="grid gap-3 sm:grid-cols-2" id="storage-mode-select">
            <button
              type="button"
              aria-pressed={storageMode === 'local'}
              class="group relative flex flex-col items-start gap-3 rounded-xl border p-4 text-left transition-all duration-200 {storageMode ===
              'local'
                ? 'border-primary/60 bg-primary/5 ring-1 ring-primary/30'
                : 'border-border bg-background/50 hover:border-border hover:bg-accent/40'}"
              onclick={() => (storageMode = 'local')}
            >
              <div
                class="flex size-9 items-center justify-center rounded-lg border transition-colors {storageMode ===
                'local'
                  ? 'border-primary/30 bg-primary/10 text-primary'
                  : 'border-border bg-muted text-muted-foreground group-hover:text-foreground'}"
              >
                <HardDrive class="size-4" />
              </div>
              <div class="space-y-1">
                <span class="block text-sm font-medium text-foreground"
                  >Local</span
                >
                <span class="block text-xs leading-relaxed text-muted-foreground"
                  >IndexedDB in this browser. No sign-in.</span
                >
              </div>
            </button>

            <button
              type="button"
              aria-pressed={storageMode === 'github'}
              class="group relative flex flex-col items-start gap-3 rounded-xl border p-4 text-left transition-all duration-200 {storageMode ===
              'github'
                ? 'border-primary/60 bg-primary/5 ring-1 ring-primary/30'
                : 'border-border bg-background/50 hover:border-border hover:bg-accent/40'}"
              onclick={() => (storageMode = 'github')}
            >
              <div
                class="flex size-9 items-center justify-center rounded-lg border transition-colors {storageMode ===
                'github'
                  ? 'border-primary/30 bg-primary/10 text-primary'
                  : 'border-border bg-muted text-muted-foreground group-hover:text-foreground'}"
              >
                <Cloud class="size-4" />
              </div>
              <div class="space-y-1">
                <span class="block text-sm font-medium text-foreground"
                  >GitHub</span
                >
                <span class="block text-xs leading-relaxed text-muted-foreground"
                  >Sync encrypted vault to <span class="font-mono">username/nook</span>.</span
                >
              </div>
            </button>
          </div>
        </fieldset>

        {#if storageMode === 'github'}
          <div
            class="space-y-3 rounded-xl border border-border bg-muted/30 p-4 animate-in fade-in slide-in-from-top-1 duration-200"
          >
            <div class="flex items-center justify-between gap-2">
              <label class="text-sm font-medium text-foreground" for="pat">
                Personal access token
              </label>
              <a
                href={githubPatUrl}
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                Generate new token
                <ExternalLink class="size-3" />
              </a>
            </div>
            <input
              id="pat"
              type="password"
              bind:value={githubPat}
              placeholder="ghp_xxxxxxxxxxxx"
              autocomplete="off"
              class="flex h-10 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-hidden focus:ring-2 focus:ring-ring"
            />
                <p class="text-xs leading-relaxed text-muted-foreground">
                  Use a classic token starting with
                  <span class="font-mono text-foreground/80">ghp_</span> with
                  <span class="font-mono text-foreground/80">repo</span> scope.
                  Syncs encrypted vault to
                  <span class="font-mono text-foreground/80">username/nook/nook-vault</span>.
                  Creates the <span class="font-mono text-foreground/80">nook</span> repo automatically if needed.
                  Your encryption key never leaves this browser.
                </p>
          </div>
        {:else}
          <div
            class="flex items-start gap-3 rounded-xl border border-border/60 bg-muted/20 px-4 py-3"
          >
            <Server class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <p class="text-xs leading-relaxed text-muted-foreground">
              Everything stays on this device. Clear site data to remove the vault.
            </p>
          </div>
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

        <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button
            type="submit"
            size="lg"
            class="sm:min-w-[200px]"
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

          {#if isAuthenticated && secretsCount === 0}
            <Button
              type="button"
              variant="outline"
              size="lg"
              onclick={onInitializeEmpty}
              disabled={isSaving}
              class="border-border text-foreground hover:bg-accent"
            >
              {#if isSaving}
                <RefreshCw class="size-4 animate-spin" />
              {:else}
                <GitBranch class="size-4" />
              {/if}
              Initialize empty vault
            </Button>
          {/if}
        </div>
      </form>
    </CardContent>
  </Card>
</div>
