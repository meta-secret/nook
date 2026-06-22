<script lang="ts">
  import { Cloud, ExternalLink, HardDrive, KeyRound } from '@lucide/svelte'
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

<div class="space-y-4">
  <div
    class="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm"
  >
    {#if setupType === 'github'}
      <Cloud class="size-4 shrink-0 text-foreground" />
      <span class="font-medium text-foreground">GitHub sync</span>
    {:else}
      <HardDrive class="size-4 shrink-0 text-foreground" />
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
    <div
      class="space-y-4 rounded-lg border border-primary/25 bg-primary/5 p-4 animate-in fade-in slide-in-from-top-1 duration-200"
      data-testid="github-token-setup"
    >
      <div class="space-y-3">
        <div class="flex items-start gap-3">
          <div
            class="flex size-9 shrink-0 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary"
          >
            <KeyRound class="size-4" />
          </div>
          <div class="min-w-0 flex-1 space-y-1">
            <p class="text-sm font-semibold text-foreground">
              New here? Create a GitHub token first
            </p>
            <p class="text-xs leading-relaxed text-muted-foreground">
              Nook needs a classic personal access token (<span
                class="font-mono text-foreground/90">ghp_</span
              >) with
              <span class="font-mono text-foreground/90">repo</span>
              scope so it can read and write your vault file.
            </p>
          </div>
        </div>
        <a
          href={githubPatUrl}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="github-new-token-btn"
          class={cn(
            buttonVariants({ variant: 'default', size: 'default' }),
            'w-full sm:w-auto',
          )}
        >
          Create token on GitHub
          <ExternalLink class="size-4" />
        </a>
      </div>

      <ol class="space-y-4 border-t border-primary/15 pt-4">
        <li class="flex gap-3">
          <span
            class="flex size-5 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-[10px] font-semibold text-primary"
            aria-hidden="true">1</span
          >
          <div class="min-w-0 flex-1 space-y-1.5">
            <p class="text-xs font-medium text-foreground">
              Open GitHub and generate the token
            </p>
            <p class="text-[11px] leading-relaxed text-muted-foreground">
              Use the button above — GitHub opens with
              <span class="font-mono">repo</span> scope pre-selected. Copy the token
              when it is shown; you will not see it again.
            </p>
          </div>
        </li>

        <li class="flex gap-3">
          <span
            class="flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-background text-[10px] font-semibold text-muted-foreground"
            aria-hidden="true">2</span
          >
          <div class="min-w-0 flex-1 space-y-1.5">
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
            <p class="text-[11px] text-muted-foreground">
              Repo under your account — vault file is
              <span class="font-mono text-foreground/80">nook-vault.yaml</span>.
              Use a different name for a second vault.
            </p>
          </div>
        </li>

        <li class="flex gap-3">
          <span
            class="flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-background text-[10px] font-semibold text-muted-foreground"
            aria-hidden="true">3</span
          >
          <div class="min-w-0 flex-1 space-y-1.5">
            <label
              class="text-xs font-medium text-foreground"
              for="{idPrefix}-github-pat"
            >
              Paste token here
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
            <p class="text-[11px] text-muted-foreground">
              Saved in this browser after you connect. Syncs to
              <span class="font-mono text-foreground/80"
                >username/{githubRepo.trim() ||
                  DEFAULT_GITHUB_REPO}/nook-vault.yaml</span
              >
            </p>
          </div>
        </li>
      </ol>
    </div>
  {:else}
    <p class="text-xs text-muted-foreground">
      Your vault is stored in IndexedDB on this device. No token needed.
    </p>
  {/if}
</div>
