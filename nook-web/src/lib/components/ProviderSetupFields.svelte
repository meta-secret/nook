<script lang="ts">
  import { Cloud, ExternalLink, HardDrive } from '@lucide/svelte'
  import { buttonVariants } from '$lib/components/ui/button/button.svelte'
  import type { StorageProviderType } from '$lib/auth-providers'
  import { DEFAULT_GITHUB_REPO } from '$lib/auth-providers'
  import { cn } from '$lib/utils'
  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    setupType,
    githubPat = $bindable(''),
    githubRepo = $bindable(DEFAULT_GITHUB_REPO),
    idPrefix = 'provider',
    onCancelSetup,
  }: {
    vault: VaultState
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
      <span class="font-medium text-foreground"
        >{vault.t('provider_picker.github')}</span
      >
    {:else}
      <HardDrive class="size-4 shrink-0 text-muted-foreground" />
      <span class="font-medium text-foreground"
        >{vault.t('provider_picker.this_device')}</span
      >
    {/if}
    <button
      type="button"
      class="ml-auto text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
      data-testid="cancel-provider-setup"
      onclick={onCancelSetup}
    >
      {vault.t('provider_setup.change_provider')}
    </button>
  </div>

  {#if setupType === 'github'}
    <div class="space-y-5" data-testid="github-token-setup">
      <div class="space-y-2">
        <p class="text-sm text-foreground text-pretty">
          {vault.t('provider_setup.github_pat_desc')}
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
          {vault.t('provider_setup.create_token_github')}
          <ExternalLink class="size-3.5" />
        </a>
      </div>

      <div class="space-y-4">
        <div class="space-y-1.5">
          <label
            class="text-xs font-medium text-foreground"
            for="{idPrefix}-github-repo"
          >
            {vault.t('provider_setup.repo_name')}
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
            {vault.t('provider_setup.vault_file_desc')}
          </p>
        </div>

        <div class="space-y-1.5">
          <label
            class="text-xs font-medium text-foreground"
            for="{idPrefix}-github-pat"
          >
            {vault.t('provider_setup.pat_label')}
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
            {vault.t('provider_setup.stored_locally_desc', {
              repo: githubRepo.trim() || DEFAULT_GITHUB_REPO,
            })}
          </p>
        </div>
      </div>
    </div>
  {:else}
    <p class="text-xs text-muted-foreground text-pretty">
      {vault.t('provider_setup.local_storage_desc')}
    </p>
  {/if}
</div>
