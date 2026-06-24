<script lang="ts">
  import { Cloud, ExternalLink, HardDrive } from '@lucide/svelte'
  import { buttonVariants } from '$lib/components/ui/button/button.svelte'
  import type { StorageProviderType } from '$lib/auth-providers'
  import { DEFAULT_GITHUB_REPO } from '$lib/auth-providers'
  import { cn } from '$lib/utils'

  let {
    setupType,
    githubPat = $bindable(''),
    githubRepo = $bindable(DEFAULT_GITHUB_REPO),
    idPrefix = 'provider',
    onCancelSetup,
  }: {
    setupType: StorageProviderType
    githubPat: string
    githubRepo: string
    idPrefix?: string
    onCancelSetup: () => void
  } = $props()

  const githubPatUrl =
    'https://github.com/settings/tokens/new?scopes=repo&description=nook'
</script>

<div class="space-y-5">
  <div class="flex items-center gap-2 text-sm">
    {#if setupType === 'github'}
      <Cloud class="size-4 shrink-0 text-muted-foreground" />
      <span class="font-medium text-foreground">GitHub</span>
    {:else}
      <HardDrive class="size-4 shrink-0 text-muted-foreground" />
      <span class="font-medium text-foreground">This device</span>
    {/if}
    <button
      type="button"
      class="ml-auto text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
      data-testid="cancel-provider-setup"
      onclick={onCancelSetup}
    >
      Change provider
    </button>
  </div>

  {#if setupType === 'github'}
    <div class="space-y-5" data-testid="github-token-setup">
      <div class="space-y-2">
        <p class="text-sm text-foreground text-pretty">
          Nook needs a classic personal access token (<span class="font-mono"
            >ghp_</span
          >) with <span class="font-mono">repo</span> scope to sync your vault file.
        </p>
        <a
          href={githubPatUrl}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="github-new-token-btn"
          class={cn(
            buttonVariants({ variant: 'default', size: 'sm' }),
            'w-full sm:w-auto',
          )}
        >
          Create token on GitHub
          <ExternalLink class="size-3.5" />
        </a>
      </div>

      <div class="space-y-4">
        <div class="space-y-1.5">
          <label
            class="text-xs font-medium text-foreground"
            for="{idPrefix}-github-repo"
          >
            Repository name
          </label>
          <input
            id="{idPrefix}-github-repo"
            type="text"
            bind:value={githubRepo}
            placeholder={DEFAULT_GITHUB_REPO}
            autocomplete="off"
            spellcheck="false"
            data-testid="github-repo-input"
            class="flex h-9 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-hidden focus:ring-2 focus:ring-ring"
          />
          <p class="text-[11px] text-muted-foreground text-pretty">
            Vault file:
            <span class="font-mono text-foreground/80">nook-vault.yaml</span>
            in this repo under your account.
          </p>
        </div>

        <div class="space-y-1.5">
          <label
            class="text-xs font-medium text-foreground"
            for="{idPrefix}-github-pat"
          >
            Personal access token
          </label>
          <input
            id="{idPrefix}-github-pat"
            type="password"
            bind:value={githubPat}
            placeholder="ghp_xxxxxxxxxxxx"
            autocomplete="off"
            data-testid="github-pat-input"
            class="flex h-9 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-hidden focus:ring-2 focus:ring-ring"
          />
          <p class="text-[11px] text-muted-foreground text-pretty">
            Stored in this browser only. Syncs to
            <span class="font-mono text-foreground/80"
              >username/{githubRepo.trim() ||
                DEFAULT_GITHUB_REPO}/nook-vault.yaml</span
            >.
          </p>
        </div>
      </div>
    </div>
  {:else}
    <p class="text-xs text-muted-foreground text-pretty">
      Your vault is stored in IndexedDB on this device. No token needed.
    </p>
  {/if}
</div>
