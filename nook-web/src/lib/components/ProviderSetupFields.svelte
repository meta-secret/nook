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
    onGoogleSignIn,
  }: {
    vault: VaultState
    setupType: StorageProviderType
    githubPat: string
    githubRepo: string
    idPrefix?: string
    onCancelSetup: () => void
    onGoogleSignIn?: () => void | Promise<void>
  } = $props()

  const githubPatUrl =
    'https://github.com/settings/tokens/new?scopes=repo&description=nook'

  const googleSignedIn = $derived(
    setupType === 'oauth-file' && Boolean(vault.oauthFile?.accessToken?.trim()),
  )
  const googleAccount = $derived(vault.oauthFile?.accountEmail ?? '')
</script>

<div class="space-y-5">
  <div class="flex items-center gap-2 text-sm">
    {#if setupType === 'github'}
      <Cloud class="size-4 shrink-0 text-muted-foreground" />
      <span class="font-medium text-foreground"
        >{vault.t('provider_picker.github')}</span
      >
    {:else if setupType === 'oauth-file'}
      <svg
        class="size-4 shrink-0 text-muted-foreground"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          fill="currentColor"
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
        />
        <path
          fill="currentColor"
          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        />
        <path
          fill="currentColor"
          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        />
        <path
          fill="currentColor"
          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        />
      </svg>
      <span class="font-medium text-foreground"
        >{vault.t('provider_picker.google_drive')}</span
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
  {:else if setupType === 'oauth-file'}
    <div class="space-y-4" data-testid="google-oauth-setup">
      <p class="text-sm text-foreground text-pretty">
        {vault.t('provider_setup.google_drive_desc')}
      </p>
      <button
        type="button"
        class={cn(
          buttonVariants({ variant: 'default', size: 'sm' }),
          'w-full sm:w-auto',
        )}
        data-testid="google-sign-in-btn"
        disabled={vault.googleOAuthBusy}
        onclick={() => void onGoogleSignIn?.()}
      >
        {vault.googleOAuthBusy
          ? vault.t('provider_setup.google_signing_in')
          : vault.t('provider_setup.sign_in_with_google')}
      </button>
      {#if googleSignedIn}
        <p
          class="text-xs text-muted-foreground"
          data-testid="google-account-status"
        >
          {vault.t('provider_setup.google_signed_in_as', {
            account: googleAccount || vault.t('auth_storage.google_signed_in'),
          })}
        </p>
      {/if}
      <p class="text-[11px] text-muted-foreground text-pretty">
        {vault.t('provider_setup.google_tokens_local_desc')}
      </p>
    </div>
  {:else}
    <p class="text-xs text-muted-foreground text-pretty">
      {vault.t('provider_setup.local_storage_desc')}
    </p>
  {/if}
</div>
